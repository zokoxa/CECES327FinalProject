import { useCallback } from 'react';
import { useSocketStore } from '../store/socketStore.js';

/**
 * Returns emit/on helpers backed by the app-level singleton socket.
 * The socket itself is managed in socketStore and survives page navigation.
 */
export function useSocket() {
  const socket = useSocketStore((s) => s.socket);

  const emit = useCallback((event, data) => {
    socket?.emit(event, data);
  }, [socket]);

  const on = useCallback((event, handler) => {
    socket?.on(event, handler);
    return () => socket?.off(event, handler);
  }, [socket]);

  return { socket, emit, on };
}
