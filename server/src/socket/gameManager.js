import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { redis } from '../lib/redis.js';

const QUEUE_KEY = 'matchmaking:queue';
const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';

const gameKey       = (gameId)   => `game:${gameId}`;
const socketGameKey = (socketId) => `socket:${socketId}:game`;

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
  await Promise.all([
    redis.del(gameKey(game.id)),
    redis.del(socketGameKey(game.white.socketId)),
    redis.del(socketGameKey(game.black.socketId)),
  ]);
}

// ─── GameManager ──────────────────────────────────────────────────────────────

export class GameManager {
  constructor(io) {
    this.io = io;
  }

  // ─── Matchmaking ────────────────────────────────────────────────────────────

  async joinQueue(socket) {
    const queue = await redis.lrange(QUEUE_KEY, 0, -1);
    if (queue.includes(socket.id)) return;

    if (queue.length > 0) {
      const opponentId = await redis.lpop(QUEUE_KEY);
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
      white: { socketId: whiteSocket.id, userId: whiteSocket.user.id, username: whiteSocket.user.username },
      black: { socketId: blackSocket.id, userId: blackSocket.user.id, username: blackSocket.user.username },
      moves: [],   // array of MoveDto objects { fromRow, fromCol, toRow, toCol, type, promotion }
      status: 'active',
      startedAt: Date.now(),
    };

    await Promise.all([
      saveGame(game),
      redis.set(socketGameKey(whiteSocket.id), gameId),
      redis.set(socketGameKey(blackSocket.id), gameId),
    ]);

    whiteSocket.join(gameId);
    blackSocket.join(gameId);

    await supabase.from('games').insert({
      id: gameId,
      white_id: game.white.userId,
      black_id: game.black.userId,
      status: 'active',
    });

    const payload = { gameId, white: game.white, black: game.black };
    whiteSocket.emit('game:start', { ...payload, color: 'white' });
    blackSocket.emit('game:start', { ...payload, color: 'black' });

    console.log(`♟  Game started: ${gameId}`);
  }

  // ─── Move Handling ───────────────────────────────────────────────────────────

  async handleMove(socket, { gameId, move }) {
    // move = { fromRow, fromCol, toRow, toCol, type, promotion }
    const game = await getGame(gameId);
    if (!game || game.status !== 'active') return;

    const isWhiteTurn = game.moves.length % 2 === 0;
    const isWhite = game.white.socketId === socket.id;
    if (isWhiteTurn !== isWhite) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    // Validate with chess engine
    let engineResult;
    try {
      engineResult = await validateMove(game.moves, move);
    } catch (err) {
      console.error('Chess engine unreachable:', err.message);
      socket.emit('error', { message: 'Chess engine unavailable' });
      return;
    }

    if (!engineResult.valid) {
      socket.emit('error', { message: 'Invalid move' });
      return;
    }

    game.moves.push(move);
    await saveGame(game);

    await supabase.from('moves').insert({
      game_id: gameId,
      player_id: socket.user.id,
      move_number: game.moves.length,
      move_notation: toUci(move),
    });

    this.io.to(gameId).emit('game:move', { move, moveNumber: game.moves.length });

    // Chess engine detected game over — handle it server-side
    if (engineResult.isCheckmate) {
      const winner = isWhite ? 'white' : 'black';
      await this.handleGameOver(socket, { gameId, result: winner, reason: 'checkmate' });
    } else if (engineResult.isDraw) {
      const reason = engineResult.isStalemate ? 'stalemate' : 'fifty-move';
      await this.handleGameOver(socket, { gameId, result: 'draw', reason });
    }
  }

  // ─── Game Over ───────────────────────────────────────────────────────────────

  async handleGameOver(socket, { gameId, result, reason }) {
    const game = await getGame(gameId);
    if (!game) return;

    await deleteGame(game);
    await supabase.from('games').update({ status: 'finished', result, reason }).eq('id', gameId);

    this.io.to(gameId).emit('game:over', { result, reason });
    console.log(`🏁 Game over: ${gameId} — ${result} (${reason})`);
  }

  // ─── Resignation ─────────────────────────────────────────────────────────────

  async handleResign(socket, { gameId }) {
    const game = await getGame(gameId);
    if (!game) return;

    const isWhite = game.white.socketId === socket.id;
    await this.handleGameOver(socket, { gameId, result: isWhite ? 'black' : 'white', reason: 'resignation' });
  }

  // ─── Draw Offer ──────────────────────────────────────────────────────────────

  async handleDrawOffer(socket, { gameId }) {
    const game = await getGame(gameId);
    if (!game) return;

    const opponentId =
      game.white.socketId === socket.id ? game.black.socketId : game.white.socketId;

    this.io.sockets.sockets.get(opponentId)?.emit('game:drawOffer');
  }

  async handleDrawAccept(socket, { gameId }) {
    await this.handleGameOver(socket, { gameId, result: 'draw', reason: 'agreement' });
  }

  // ─── Disconnect Handling ──────────────────────────────────────────────────────

  async handleDisconnect(socket) {
    await this.leaveQueue(socket);

    const gameId = await redis.get(socketGameKey(socket.id));
    if (!gameId) return;

    const game = await getGame(gameId);
    if (game && game.status === 'active') {
      const isWhite = game.white.socketId === socket.id;
      await this.handleGameOver(socket, {
        gameId,
        result: isWhite ? 'black' : 'white',
        reason: 'disconnect',
      });
    }
  }
}
