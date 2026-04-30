import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { redis } from '../lib/redis.js';

const QUEUE_KEY        = 'matchmaking:queue';
const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';
const PAUSED_GAMES_KEY = 'games:paused';

const gameKey              = (gameId)             => `game:${gameId}`;
const socketGameKey        = (socketId)           => `socket:${socketId}:game`;
const userGameKey          = (userId)             => `user:${userId}:game`;
const userSocketKey        = (userId)             => `user:${userId}:socket`;
const inviteKey            = (inviteeId)          => `invite:${inviteeId}`;
const ownerFailoverLockKey = (gameId)             => `game:${gameId}:owner-failover-lock`;
const lockKey              = (gameId)             => `lock:game:${gameId}`;
const actionKey            = (gameId, moveNumber) => `action:${gameId}:${moveNumber}`;

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

// ─── Distributed Lock ─────────────────────────────────────────────────────────
// acquireLock returns a token if the lock was acquired, or null if already held.
// TTL is a safety net — the lock is always explicitly released in a finally block.
async function acquireLock(key, ttlMs = 5000) {
  const token = uuidv4();
  // NX = only set if key does not exist (atomic test-and-set)
  // PX = expire after ttlMs so a crashed process can't hold forever
  const ok = await redis.set(key, token, 'NX', 'PX', ttlMs);
  return ok ? token : null;
}

// Releases the lock only if this process still owns it (compare-and-delete via Lua).
// Prevents a slow process from deleting a lock re-acquired by someone else after TTL expiry.
const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

async function releaseLock(key, token) {
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
}

// ─── GameManager ──────────────────────────────────────────────────────────────

export class GameManager {
  /**
   * @param {import('socket.io').Server} io
   * @param {string} nodeId      - unique ID of this server node
   * @param {string} nodeAddress - HTTP base URL of this node (e.g. http://server:3001)
   */
  constructor(io, nodeId, nodeAddress, nodeRegistry) {
    this.io           = io;
    this.nodeId       = nodeId;
    this.nodeAddress  = nodeAddress;
    this.nodeRegistry = nodeRegistry;

    this.pauseExpiryInterval = setInterval(() => {
      this.expirePausedGames().catch((err) => {
        console.error('Failed to expire paused games:', err);
      });
    }, 5000);
  }

  // ─── Matchmaking ─────────────────────────────────────────────────────────────
  //
  // Matchmaking is atomic: a single Lua script runs on Redis as one uninterruptible
  // operation, preventing two nodes from matching the same waiting player simultaneously.

  async joinQueue(socket) {
    const MATCHMAKING_SCRIPT = `
      local queue = KEYS[1]
      local me    = ARGV[1]

      local opponent = redis.call('LPOP', queue)

      if opponent == me then
        redis.call('RPUSH', queue, me)
        return false
      end

      if opponent then
        return opponent
      else
        local members = redis.call('LRANGE', queue, 0, -1)
        for _, v in ipairs(members) do
          if v == me then return false end
        end
        redis.call('RPUSH', queue, me)
        return false
      end
    `;

    const opponentId = await redis.eval(MATCHMAKING_SCRIPT, 1, QUEUE_KEY, socket.id);

    if (!opponentId) {
      socket.emit('matchmaking:waiting');
      return;
    }

    const opponentSocket = this.io.sockets.sockets.get(opponentId);
    if (!opponentSocket) {
      await redis.rpush(QUEUE_KEY, socket.id);
      socket.emit('matchmaking:waiting');
      return;
    }

    await this._createGame(
      { socketId: socket.id,         userId: socket.user.id,         username: socket.user.username },
      { socketId: opponentSocket.id, userId: opponentSocket.user.id, username: opponentSocket.user.username }
    );
  }

  async leaveQueue(socket) {
    await redis.lrem(QUEUE_KEY, 0, socket.id);
  }

  // ─── Game Lifecycle ──────────────────────────────────────────────────────────

  // white / black: { socketId, userId, username }
  // Sockets do not need to be local — uses io.in() for cross-node room joins.
  async _createGame(white, black) {
    const gameId = uuidv4();
    const owner  = await this.nodeRegistry.getLeastLoadedNode();
    const game = {
      id: gameId,
      white: {
        socketId:   white.socketId,
        userId:     white.userId,
        username:   white.username,
        connected:  true,
        lastSeenAt: Date.now(),
      },
      black: {
        socketId:   black.socketId,
        userId:     black.userId,
        username:   black.username,
        connected:  true,
        lastSeenAt: Date.now(),
      },
      moves:               [],
      version:             0,
      status:              'active',
      startedAt:           Date.now(),
      updatedAt:           Date.now(),
      disconnectGraceUntil: null,

      // ── Game ownership ─────────────────────────────────────────────────────
      // The owner is chosen by the placement rule: least active games wins.
      // All move validation and state updates must go through the owner.
      ownerNodeId:  owner.nodeId,
      ownerAddress: owner.address,
    };

    await Promise.all([
      saveGame(game),
      redis.set(socketGameKey(white.socketId), gameId),
      redis.set(socketGameKey(black.socketId), gameId),
      redis.set(userGameKey(game.white.userId), gameId),
      redis.set(userGameKey(game.black.userId), gameId),
    ]);

    // socketsJoin works across nodes via the Redis adapter
    await this.io.in(white.socketId).socketsJoin(gameId);
    await this.io.in(black.socketId).socketsJoin(gameId);

    await supabase.from('games').insert({
      id:       gameId,
      white_id: game.white.userId,
      black_id: game.black.userId,
      status:   'active',
    });

    await this.nodeRegistry.incrementLoad(owner.nodeId);

    const payload = { gameId, white: game.white, black: game.black };
    this.io.to(white.socketId).emit('game:start', { ...payload, color: 'white' });
    this.io.to(black.socketId).emit('game:start', { ...payload, color: 'black' });

    console.log(`♟  Game ${gameId} created — owner: [${owner.nodeId}] (load-balanced)`);
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
    const failoverLock = ownerFailoverLockKey(gameId);

    const gotLock = await redis.set(failoverLock, this.nodeId, 'NX', 'PX', 5000);
    if (!gotLock) {
      return null;
    }

    try {
      const game = await getGame(gameId);
      if (!game) return null;
      if (game.ownerNodeId === this.nodeId) {
        return game;
      }

      const ownerAddress  = await this.nodeRegistry.getAddress(game.ownerNodeId);
      const ownerLooksDead = !ownerAddress;

      if (!ownerLooksDead) {
        return game;
      }

      const previousOwner  = game.ownerNodeId;
      game.ownerNodeId  = this.nodeId;
      game.ownerAddress = this.nodeAddress;
      game.updatedAt    = Date.now();

      await saveGame(game);
      await this.nodeRegistry.decrementLoad(previousOwner);
      await this.nodeRegistry.incrementLoad(this.nodeId);
      return game;
    } finally {
      await redis.del(failoverLock);
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

    side.socketId   = socket.id;
    side.connected  = true;
    side.lastSeenAt = Date.now();

    await redis.set(socketGameKey(socket.id), game.id);

    socket.join(game.id);

    const bothConnected = game.white.connected && game.black.connected;
    if (bothConnected) {
      game.status              = 'active';
      game.disconnectGraceUntil = null;
      await redis.srem(PAUSED_GAMES_KEY, game.id);
    }

    game.updatedAt = Date.now();
    await saveGame(game);

    socket.emit('game:resume', {
      gameId:     game.id,
      color:      isWhite ? 'white' : 'black',
      white:      game.white,
      black:      game.black,
      moves:      game.moves,
      status:     game.status,
      graceUntil: game.disconnectGraceUntil,
    });

    this.io.to(game.id).emit('game:playerReconnected', {
      color: isWhite ? 'white' : 'black',
    });

    if (bothConnected) {
      this.io.to(game.id).emit('game:resumed', { gameId: game.id });
    }
  }

  // ─── Move Handling ───────────────────────────────────────────────────────────

  async handleMove(socket, { gameId, move }) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    // ── Cross-node forwarding ──────────────────────────────────────────────
    // If this node does not own the game, forward the move to the owner node.
    if (game.ownerNodeId !== this.nodeId) {
      console.log(`↪  Routing move to owner node [${game.ownerNodeId}] at ${game.ownerAddress}`);
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
      if (localErr) socket.emit('error', { message: localErr });
      return;
    }

    // ── This node owns the game — process normally ─────────────────────────
    const err = await this._processMove(socket.user.id, game, move);
    if (err) socket.emit('error', { message: err });
  }

  /**
   * Core move processor — only called on the owner node.
   * Can be invoked directly (local socket) or via the /internal/move endpoint
   * (routed from a non-owner node).
   *
   * @returns {string|null} error message, or null on success
   */
  async processForwardedMove({ gameId, move, userId }) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return 'Game not found';
    return this._processMove(userId, game, move);
  }

  /**
   * _processMove has two layers of duplicate-action protection.
   *
   * Layer 1 — Distributed lock (mutex):
   *   Only one _processMove call for a given game can run at a time across all
   *   nodes. A concurrent call immediately gets "Move already being processed".
   *   The lock is released via compare-and-delete Lua so a slow process can't
   *   accidentally release a lock it no longer owns after TTL expiry.
   *
   * Layer 2 — Idempotency key:
   *   After acquiring the lock, game state is re-fetched so we see any move
   *   that landed between the caller reading the game and us acquiring the lock.
   *   We then write a short-lived key on (gameId + current move-number). If a
   *   client retries the exact same move after a disconnect the key still exists
   *   and we return early without double-applying. TTL is 30 s.
   */
  async _processMove(userId, game, move) {
    const mux = lockKey(game.id);
    let lockToken = null;

    try {
      // ── Layer 1: acquire the per-game mutex ────────────────────────────────
      lockToken = await acquireLock(mux, 5000);
      if (!lockToken) return 'Move already being processed';

      // Re-fetch inside the lock to see moves that landed while we were waiting.
      const freshGame = await getGame(game.id);
      if (!freshGame || freshGame.status !== 'active') return 'Game not found';

      // ── Layer 2: idempotency check ─────────────────────────────────────────
      const idemKey      = actionKey(freshGame.id, freshGame.moves.length);
      const alreadyApplied = await redis.set(idemKey, '1', 'NX', 'PX', 30_000);
      if (!alreadyApplied) return 'Duplicate action rejected';

      // ── Turn validation ────────────────────────────────────────────────────
      const isWhiteTurn = freshGame.moves.length % 2 === 0;
      const isWhite     = freshGame.white.userId === userId;
      if (isWhiteTurn !== isWhite) return 'Not your turn';

      // ── Chess engine validation ────────────────────────────────────────────
      let engineResult;
      try {
        engineResult = await validateMove(freshGame.moves, move);
      } catch {
        return 'Chess engine unavailable';
      }
      if (!engineResult.valid) return 'Invalid move';

      // ── Persist ────────────────────────────────────────────────────────────
      freshGame.moves.push(move);
      await saveGame(freshGame);

      await supabase.from('moves').insert({
        game_id:       freshGame.id,
        player_id:     userId,
        move_number:   freshGame.moves.length,
        move_notation: toUci(move),
      });

      // Broadcast to all nodes via Redis adapter
      this.io.to(freshGame.id).emit('game:move', { move, moveNumber: freshGame.moves.length });

      // ── End-of-game checks ─────────────────────────────────────────────────
      if (engineResult.isCheckmate) {
        const winner = isWhite ? 'white' : 'black';
        await this.handleGameOver(null, { gameId: freshGame.id, result: winner, reason: 'checkmate' });
      } else if (engineResult.isDraw) {
        const reason = engineResult.isStalemate ? 'stalemate' : 'fifty-move';
        await this.handleGameOver(null, { gameId: freshGame.id, result: 'draw', reason });
      }

      return null;

    } finally {
      // releaseLock is a no-op if lockToken is null (we never acquired the lock).
      if (lockToken) await releaseLock(mux, lockToken);
    }
  }

  /**
   * HTTP POST to the owner node's /internal/move endpoint (cross-node routing).
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
    await this.nodeRegistry.decrementLoad(game.ownerNodeId);
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

  async handleDrawOffer(socket, { gameId } = {}) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    const isWhite = game.white.userId === socket.user.id;
    const isBlack = game.black.userId === socket.user.id;
    if (!isWhite && !isBlack) return;

    const opponent = isWhite ? game.black : game.white;
    if (!opponent?.socketId || opponent.connected === false) {
      socket.emit('error', { message: 'Opponent is not connected' });
      return;
    }

    const offeredBy         = isWhite ? 'white' : 'black';
    const offeredByUsername = isWhite ? game.white.username : game.black.username;
    this.io.to(opponent.socketId).emit('game:drawOffer', {
      gameId,
      offeredBy,
      offeredByUsername,
    });

    socket.emit('game:drawOfferSent', { gameId });
  }

  async handleDrawAccept(socket, { gameId } = {}) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    const isWhite = game.white.userId === socket.user.id;
    const isBlack = game.black.userId === socket.user.id;
    if (!isWhite && !isBlack) return;

    await this.handleGameOver(null, { gameId, result: 'draw', reason: 'agreement' });
  }

  async handleDrawDecline(socket, { gameId } = {}) {
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    const isWhite = game.white.userId === socket.user.id;
    const isBlack = game.black.userId === socket.user.id;
    if (!isWhite && !isBlack) return;

    const opponent = isWhite ? game.black : game.white;
    if (!opponent?.socketId) return;

    this.io.to(opponent.socketId).emit('game:drawDeclined', { gameId });
  }

  // ─── Connection tracking ──────────────────────────────────────────────────────

  async handleConnect(socket) {
    const oldSocketId = await redis.get(userSocketKey(socket.user.id));
    if (oldSocketId && oldSocketId !== socket.id) {
      this.io.to(oldSocketId).emit('session:invalidated');
    }
    await redis.set(userSocketKey(socket.user.id), socket.id, 'EX', 86400);
  }

  // ─── Invites ──────────────────────────────────────────────────────────────────

  async handleInviteSend(socket, { targetUsername } = {}) {
    if (!targetUsername) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('username', targetUsername)
      .single();

    if (!profile) {
      socket.emit('invite:error', { message: 'User not found' });
      return;
    }
    if (profile.id === socket.user.id) {
      socket.emit('invite:error', { message: 'You cannot invite yourself' });
      return;
    }

    const targetSocketId = await redis.get(userSocketKey(profile.id));
    if (!targetSocketId) {
      socket.emit('invite:error', { message: `${targetUsername} is not online` });
      return;
    }

    const targetGameId = await redis.get(userGameKey(profile.id));
    if (targetGameId) {
      socket.emit('invite:error', { message: `${targetUsername} is already in a game` });
      return;
    }

    await redis.set(
      inviteKey(profile.id),
      JSON.stringify({ fromUserId: socket.user.id, fromUsername: socket.user.username }),
      'EX', 60
    );

    this.io.to(targetSocketId).emit('invite:incoming', {
      fromUsername: socket.user.username,
      fromUserId:   socket.user.id,
    });

    socket.emit('invite:sent', { toUsername: targetUsername, toUserId: profile.id });
    console.log(`📩 ${socket.user.username} invited ${targetUsername}`);
  }

  async handleInviteAccept(socket, { fromUserId } = {}) {
    const raw = await redis.get(inviteKey(socket.user.id));
    if (!raw) {
      socket.emit('invite:error', { message: 'Invite expired or was cancelled' });
      return;
    }

    const { fromUserId: storedId, fromUsername } = JSON.parse(raw);
    if (storedId !== fromUserId) {
      socket.emit('invite:error', { message: 'Invite mismatch' });
      return;
    }

    await redis.del(inviteKey(socket.user.id));

    const inviterSocketId = await redis.get(userSocketKey(fromUserId));
    if (!inviterSocketId) {
      socket.emit('invite:error', { message: `${fromUsername} is no longer online` });
      return;
    }

    const inviterGameId   = await redis.get(userGameKey(fromUserId));
    const acceptorGameId  = await redis.get(userGameKey(socket.user.id));
    if (inviterGameId || acceptorGameId) {
      socket.emit('invite:error', { message: 'A player is already in a game' });
      return;
    }

    await this._createGame(
      { socketId: inviterSocketId, userId: fromUserId,       username: fromUsername },
      { socketId: socket.id,       userId: socket.user.id,   username: socket.user.username }
    );
  }

  async handleInviteDecline(socket, { fromUserId } = {}) {
    await redis.del(inviteKey(socket.user.id));
    const inviterSocketId = await redis.get(userSocketKey(fromUserId));
    if (inviterSocketId) {
      this.io.to(inviterSocketId).emit('invite:declined', { byUsername: socket.user.username });
    }
  }

  async handleInviteCancel(socket, { targetUserId } = {}) {
    await redis.del(inviteKey(targetUserId));
    const targetSocketId = await redis.get(userSocketKey(targetUserId));
    if (targetSocketId) {
      this.io.to(targetSocketId).emit('invite:cancelled');
    }
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────────

  async handleDisconnect(socket) {
    const currentSocketId = await redis.get(userSocketKey(socket.user.id));
    if (currentSocketId === socket.id) {
      await redis.del(userSocketKey(socket.user.id));
    }
    await this.leaveQueue(socket);

    const gameId = await redis.get(socketGameKey(socket.id));
    if (!gameId) return;

    const game = await getGame(gameId);
    if (!game) return;

    if (game.status !== 'active') return;

    const isWhite = game.white.userId === socket.user.id;
    const side = isWhite ? game.white : game.black;

    side.connected  = false;
    side.socketId   = null;
    side.lastSeenAt = Date.now();

    game.status              = 'paused';
    game.disconnectGraceUntil = Date.now() + 2 * 60 * 1000; // 2 minutes
    game.updatedAt           = Date.now();

    await saveGame(game);
    await redis.sadd(PAUSED_GAMES_KEY, game.id);

    this.io.to(game.id).emit('game:paused', {
      gameId:            game.id,
      disconnectedColor: isWhite ? 'white' : 'black',
      graceUntil:        game.disconnectGraceUntil,
    });

    console.log(`Game ${game.id} paused because a player disconnected`);
  }
}
