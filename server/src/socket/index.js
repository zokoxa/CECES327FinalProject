import { GameManager } from './gameManager.js';

/**
 * Register all Socket.io event handlers.
 * Called once during server startup with the io instance.
 */
export function registerSocketHandlers(io, nodeId, nodeAddress) {
  const gameManager = new GameManager(io, nodeId, nodeAddress);

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.user.username} (${socket.id})`);

    // ── Matchmaking ────────────────────────────────────────────────────────
    socket.on('matchmaking:join', () => gameManager.joinQueue(socket));
    socket.on('matchmaking:leave', () => gameManager.leaveQueue(socket));

    // ── In-game Events ─────────────────────────────────────────────────────
    socket.on('game:move', (data) => gameManager.handleMove(socket, data));
    socket.on('game:resign', (data) => gameManager.handleResign(socket, data));
    socket.on('game:drawOffer', (data) => gameManager.handleDrawOffer(socket, data));
    socket.on('game:drawAccept', (data) => gameManager.handleDrawAccept(socket, data));

    // Emitted by the client when the local chess engine detects game over
    // (checkmate, stalemate, etc.)
    socket.on('game:over', (data) => gameManager.handleGameOver(socket, data));


    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socket.user.username} (${socket.id})`);
      gameManager.handleDisconnect(socket);
    });
  });

  return gameManager;
}
