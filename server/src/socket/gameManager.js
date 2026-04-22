import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { redis } from '../lib/redis.js';

const QUEUE_KEY        = 'matchmaking:queue';
const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';
const PAUSED_GAMES_KEY = 'games:paused';

const gameKey       = (gameId)   => `game:${gameId}`;
const socketGameKey = (socketId) => `socket:${socketId}:game`;
const userGameKey = (userId) => `user:${userId}:game`;
const ownerFailoverLockKey = (gameId) => `game:${gameId}:owner-failover-lock`;

// ─── Chess Engine ─────────────────────────────────────────────────────────────

async function validateMove(history, move) {
  const res = await fetch(`${CHESS_ENGINE_URL}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, move }),
  });
  return res.json();
}

// Converts a MoveDto to a UCI-style string (e.g. "e2e4", "e7e8q")
function toUci({ fromRow, fromCol, toRow, toCol, promotion }) {
  const cols = 'abcdefgh';
  const from = `${cols[fromCol]}${8 - fromRow}`;
  const to   = `${cols[toCol]}${8 - toRow}`;
  const promo = promotion ? ['', 'p', 'r', 'n', 'b', 'q', 'k'][promotion] : '';
  return `${from}${to}${promo}`;
}

// ─── Redis Helpers ────────────────────────────────────────────────────────────

async function getGame(gameId) {
  const data = await redis.get(gameKey(gameId));
  return data ? JSON.parse(data) : null;
}

async function saveGame(game) {
  await redis.set(gameKey(game.id), JSON.stringify(game));
}

async function deleteGame(game) {
  const keys = [gameKey(game.id)];

  if (game.white?.socketId) keys.push(socketGameKey(game.white.socketId));
  if (game.black?.socketId) keys.push(socketGameKey(game.black.socketId));

  if (game.white?.userId) keys.push(userGameKey(game.white.userId));
  if (game.black?.userId) keys.push(userGameKey(game.black.userId));

  await redis.del(...keys);
}

// ─── GameManager ──────────────────────────────────────────────────────────────

export class GameManager {
  /**
   * @param {import('socket.io').Server} io
   * @param {string} nodeId      - unique ID of this peer node
   * @param {string} nodeAddress - HTTP base URL of this peer (e.g. http://server:3001)
   */
  constructor(io, nodeId, nodeAddress, peerRegistry) {
    this.io          = io;
    this.nodeId      = nodeId;
    this.nodeAddress = nodeAddress;
    this.peerRegistry = peerRegistry;

    this.pauseExpiryInterval = setInterval(() => {
      this.expirePausedGames().catch((err) => {
        console.error('Failed to expire paused games:', err);
      });
    }, 5000);
  }

  // ─── Matchmaking ────────────────────────────────────────────────────────────

  async joinQueue(socket) {
    const queue = await redis.lrange(QUEUE_KEY, 0, -1);
    if (queue.includes(socket.id)) return;

    if (queue.length > 0) {
      const opponentId     = await redis.lpop(QUEUE_KEY);
      const opponentSocket = this.io.sockets.sockets.get(opponentId);

      if (!opponentSocket) {
        await redis.rpush(QUEUE_KEY, socket.id);
        socket.emit('matchmaking:waiting');
        return;
      }

      await this._createGame(socket, opponentSocket);
    } else {
      await redis.rpush(QUEUE_KEY, socket.id);
      socket.emit('matchmaking:waiting');
    }
  }

  async leaveQueue(socket) {
    await redis.lrem(QUEUE_KEY, 0, socket.id);
  }

  // ─── Game Lifecycle ──────────────────────────────────────────────────────────

  async _createGame(whiteSocket, blackSocket) {
    const gameId = uuidv4();
    const game = {
      id: gameId,
      white: {
        socketId: whiteSocket.id,
        userId:   whiteSocket.user.id,
        username: whiteSocket.user.username,
        connected: true, 
        lastSeenAt: Date.now(),
      },
      black: {
        socketId: blackSocket.id,
        userId:   blackSocket.user.id,
        username: blackSocket.user.username,
        connected: true,
        lastSeenAt: Date.now(),
      },
      moves:    [],
      status:   'active',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      disconnectGraceUntil: null,

      // ── P2P ownership ──────────────────────────────────────────────────────
      // The node that creates the game becomes its authoritative owner.
      // All move validation and state updates must go through the owner.
      ownerNodeId:  this.nodeId,
      ownerAddress: this.nodeAddress,
    };

    await Promise.all([
      saveGame(game),
      redis.set(socketGameKey(whiteSocket.id), gameId),
      redis.set(socketGameKey(blackSocket.id), gameId),
      redis.set(userGameKey(game.white.userId), gameId),
      redis.set(userGameKey(game.black.userId), gameId),
    ]);

    whiteSocket.join(gameId);
    blackSocket.join(gameId);

    await supabase.from('games').insert({
      id:       gameId,
      white_id: game.white.userId,
      black_id: game.black.userId,
      status:   'active',
    });

    const payload = { gameId, white: game.white, black: game.black };
    whiteSocket.emit('game:start', { ...payload, color: 'white' });
    blackSocket.emit('game:start', { ...payload, color: 'black' });

    console.log(`♟  Game ${gameId} created — owner: [${this.nodeId}]`);
  }

  // ─── Game Recovery ───────────────────────────────────────────────────────────

  async findRecoverableGameForUser(userId) {
    const gameId = await redis.get(userGameKey(userId));
    if (!gameId) return null;

    const game = await getGame(gameId);
    if (!game) return null;

    if (game.status !== 'active' && game.status !== 'paused') {
      return null;
    }

    if (
      game.status === 'paused' &&
      game.disconnectGraceUntil &&
      Date.now() > game.disconnectGraceUntil
    ) {
      return null;
    }
    return game;
    }

  async tryTakeOwnership(gameId) {
    const lockKey = ownerFailoverLockKey(gameId);

    const gotLock = await redis.set(lockKey, this.nodeId, 'NX', 'PX', 5000);
    if (!gotLock) {
      return null;
    }

    try {
      const game = await getGame(gameId);
      if (!game) return null;
      if (game.ownerNodeId === this.nodeId) {
        return game;
      }

      const ownerAddress = await this.peerRegistry.getAddress(game.ownerNodeId);
      const ownerLooksDead = !ownerAddress;

      if (!ownerLooksDead) {
        return game;
      }

      game.ownerNodeId = this.nodeId;
      game.ownerAddress = this.nodeAddress;
      game.updatedAt = Date.now();

      await saveGame(game);
      return game;
    } finally {
      await redis.del(lockKey);
    }
  } 

  async handleReconnectRequest(socket) {
    const game = await this.findRecoverableGameForUser(socket.user.id);
    if (!game) {
      socket.emit('game:reconnectNotFound');
      return;
    }

    const isWhite = game.white.userId === socket.user.id;
    const side = isWhite ? game.white : game.black;

    side.socketId = socket.id;
    side.connected = true;
    side.lastSeenAt = Date.now();

    await redis.set(socketGameKey(socket.id), game.id);

    socket.join(game.id);

    const bothConnected = game.white.connected && game.black.connected;
    if (bothConnected) {
      game.status = 'active';
      game.disconnectGraceUntil = null;
      await redis.srem(PAUSED_GAMES_KEY, game.id);
    }

    game.updatedAt = Date.now();
    await saveGame(game);

    socket.emit('game:resume', {
      gameId: game.id,
      color: isWhite ? 'white' : 'black',
      white: game.white,
      black: game.black,
      moves: game.moves,
      status: game.status,
      graceUntil: game.disconnectGraceUntil,
    });

    this.io.to(game.id).emit('game:playerReconnected', {
      color: isWhite ? 'white' : 'black',
    });

    if (bothConnected) {
      this.io.to(game.id).emit('game:resumed', {
        gameId: game.id,
      });
    }
  }

  // ─── Move Handling ───────────────────────────────────────────────────────────

  async handleMove(socket, { gameId, move }) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    // ── P2P forwarding ─────────────────────────────────────────────────────
    // If this node does not own the game, forward the move to the owner node.
    // The owner will validate, persist, and broadcast the result to all nodes
    // via the Socket.io Redis adapter.
    if (game.ownerNodeId !== this.nodeId) {
      console.log(`↪  Forwarding move to owner [${game.ownerNodeId}] at ${game.ownerAddress}`);
      const err = await this._forwardMove(game.ownerAddress, {
        gameId,
        move,
        userId: socket.user.id,
      });
      if (!err) return;

      if (err !== 'Owner node unreachable') {
        socket.emit('error', { message: err });
        return;
      }
      const updatedGame = await this.tryTakeOwnership(gameId);

      if (!updatedGame || updatedGame.ownerNodeId !== this.nodeId) {
        socket.emit('error', { message: 'Owner node unreachable and failover failed' });
        return;
      }

      const localErr = await this._processMove(socket.user.id, updatedGame, move);
      if (localErr) {
        socket.emit('error', { message: localErr });
      }

      return;
    }

    // ── This node owns the game — process normally ─────────────────────────
    const err = await this._processMove(socket.user.id, game, move);
    if (err) socket.emit('error', { message: err });
  }

  /**
   * Core move processor — only called on the owner node.
   * Can be invoked directly (local socket) or via the /internal/move endpoint
   * (forwarded from a non-owner peer).
   *
   * @returns {string|null} error message, or null on success
   */
  async processForwardedMove({ gameId, move, userId }) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return 'Game not found';
    return this._processMove(userId, game, move);
  }

  async _processMove(userId, game, move) {
    const isWhiteTurn = game.moves.length % 2 === 0;
    const isWhite     = game.white.userId === userId;

    if (isWhiteTurn !== isWhite) return 'Not your turn';

    let engineResult;
    try {
      engineResult = await validateMove(game.moves, move);
    } catch {
      return 'Chess engine unavailable';
    }

    if (!engineResult.valid) return 'Invalid move';

    game.moves.push(move);
    await saveGame(game);

    await supabase.from('moves').insert({
      game_id:       game.id,
      player_id:     userId,
      move_number:   game.moves.length,
      move_notation: toUci(move),
    });

    // Broadcast to all nodes via Redis adapter — reaches every connected client
    this.io.to(game.id).emit('game:move', { move, moveNumber: game.moves.length });

    if (engineResult.isCheckmate) {
      const winner = isWhite ? 'white' : 'black';
      await this.handleGameOver(null, { gameId: game.id, result: winner, reason: 'checkmate' });
    } else if (engineResult.isDraw) {
      const reason = engineResult.isStalemate ? 'stalemate' : 'fifty-move';
      await this.handleGameOver(null, { gameId: game.id, result: 'draw', reason });
    }

    return null;
  }

  /**
   * HTTP POST to the owner node's /internal/move endpoint.
   * @returns {string|null} error message, or null on success
   */
  async _forwardMove(ownerAddress, payload) {
    try {
      const res = await fetch(`${ownerAddress}/internal/move`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const body = await res.json();
      return res.ok ? null : (body.error ?? 'Move rejected by owner node');
    } catch (err) {
      console.error('Failed to reach owner node:', err.message);
      return 'Owner node unreachable';
    }
  }

  // ─── Game Over ───────────────────────────────────────────────────────────────

  async handleGameOver(_socket, { gameId, result, reason }) {
    const game = await getGame(gameId);
    if (!game) return;

    await redis.srem(PAUSED_GAMES_KEY, game.id);
    await deleteGame(game);
    await supabase.from('games').update({ status: 'finished', result, reason }).eq('id', gameId);

    this.io.to(gameId).emit('game:over', { result, reason });
    console.log(`🏁 Game ${gameId} over — ${result} (${reason}) on [${this.nodeId}]`);
  }

  async expirePausedGames() {
    const gameIds = await redis.smembers(PAUSED_GAMES_KEY);
    if (!gameIds.length) return;

    const now = Date.now();

    for (const gameId of gameIds) {
      const game = await getGame(gameId);
      if (!game) {
        await redis.srem(PAUSED_GAMES_KEY, gameId);
        continue;
      }
      if (game.status !== 'paused') {
        await redis.srem(PAUSED_GAMES_KEY, gameId);
        continue;
      }
      if (game.ownerNodeId !== this.nodeId) {
        continue;
      }
      if (!game.disconnectGraceUntil || now < game.disconnectGraceUntil) {
        continue;
      }

      const whiteConnected = !!game.white?.connected;
      const blackConnected = !!game.black?.connected;
      let result = 'draw';
      let reason = 'disconnect_timeout';

      if (whiteConnected && !blackConnected) {
        result = 'white';
      } else if (!whiteConnected && blackConnected) {
        result = 'black';
      } else {
        result = 'draw';
        reason = 'abandonment';
      }

      await this.handleGameOver(null, { gameId, result, reason });
    }
  }

  // ─── Resignation ─────────────────────────────────────────────────────────────

  async handleResign(socket, { gameId }) {
    const game = await getGame(gameId);
    if (!game) return;

    const isWhite = game.white.userId === socket.user.id;
    await this.handleGameOver(null, {
      gameId,
      result: isWhite ? 'black' : 'white',
      reason: 'resignation',
    });
  }

  // ─── Draw Offer ──────────────────────────────────────────────────────────────

  async handleDrawOffer(socket, { gameId }) {
    const game = await getGame(gameId);
    if (!game) return;

    const opponentId =
      game.white.userId === socket.user.id ? game.black.socketId : game.white.socketId;

    this.io.sockets.sockets.get(opponentId)?.emit('game:drawOffer');
  }

  async handleDrawAccept(socket, { gameId }) {
    await this.handleGameOver(null, { gameId, result: 'draw', reason: 'agreement' });
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────────

  async handleDisconnect(socket) {
    await this.leaveQueue(socket);

    const gameId = await redis.get(socketGameKey(socket.id));
    if (!gameId) return;

    const game = await getGame(gameId);
    if (!game) return;

    // If the game is already over, no need to do anything
    if (game.status !== 'active') return;

    const isWhite = game.white.userId === socket.user.id;
    const side = isWhite ? game.white : game.black;

    side.connected = false;
    side.socketId = null;
    side.lastSeenAt = Date.now();

    game.status = 'paused';
    game.disconnectGraceUntil = Date.now() + 2 * 60 * 1000; // 2 minutes
    game.updatedAt = Date.now();

    await saveGame(game);
    await redis.sadd(PAUSED_GAMES_KEY, game.id);

    this.io.to(game.id).emit('game:paused', {
      gameId: game.id,
      disconnectedColor: isWhite ? 'white' : 'black',
      graceUntil: game.disconnectGraceUntil,
    });

    console.log(`Game ${game.id} paused because a player disconnected`);
  }
}
