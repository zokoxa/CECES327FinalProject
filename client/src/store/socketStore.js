import { create } from 'zustand';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const useSocketStore = create((set, get) => ({
  socket: null,

  connect: (token) => {
    const existing = get().socket;
    if (existing?.connected) return;
    if (existing) existing.disconnect();

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });

    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
