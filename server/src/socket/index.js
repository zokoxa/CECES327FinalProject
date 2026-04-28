import { GameManager } from './gameManager.js';

/**
 * Register all Socket.io event handlers.
 * Called once during server startup with the io instance.
 */
export function registerSocketHandlers(io, nodeId, nodeAddress, nodeRegistry) {
  const gameManager = new GameManager(io, nodeId, nodeAddress, nodeRegistry);

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.user.username} (${socket.id})`);
    gameManager.handleConnect(socket);

    // ── Matchmaking ────────────────────────────────────────────────────────
    socket.on('matchmaking:join', () => gameManager.joinQueue(socket));
    socket.on('matchmaking:leave', () => gameManager.leaveQueue(socket));

    // ── Invites ────────────────────────────────────────────────────────────
    socket.on('invite:send',    (data) => gameManager.handleInviteSend(socket, data));
    socket.on('invite:accept',  (data) => gameManager.handleInviteAccept(socket, data));
    socket.on('invite:decline', (data) => gameManager.handleInviteDecline(socket, data));
    socket.on('invite:cancel',  (data) => gameManager.handleInviteCancel(socket, data));

    // ── In-game Events ─────────────────────────────────────────────────────
    socket.on('game:move', (data) => gameManager.handleMove(socket, data));
    socket.on('game:resign', (data) => gameManager.handleResign(socket, data));
    socket.on('game:drawOffer', (data) => gameManager.handleDrawOffer(socket, data));
    socket.on('game:drawAccept', (data) => gameManager.handleDrawAccept(socket, data));
    socket.on('game:drawDecline', (data) => gameManager.handleDrawDecline(socket, data));
    socket.on('game:reconnectRequest', () => gameManager.handleReconnectRequest(socket));

    socket.on('game:over', (data) => gameManager.handleGameOver(socket, data));

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socket.user.username} (${socket.id})`);
      gameManager.handleDisconnect(socket);
    });
  });

  return gameManager;
}
