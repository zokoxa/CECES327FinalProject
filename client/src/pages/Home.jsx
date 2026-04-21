import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { useSocket } from '../hooks/useSocket.js';

export default function Home() {
  const { username, user, signOut } = useAuthStore();
  const { emit, on } = useSocket();
  const [status, setStatus] = useState('idle'); // 'idle' | 'waiting' | 'starting'
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for matchmaking events
    const offWaiting = on('matchmaking:waiting', () => setStatus('waiting'));
    const offStart = on('game:start', ({ gameId, color, white, black }) => {
      setStatus('starting');
      navigate(`/game/${gameId}`, { state: { color, white, black } });
    });

    return () => {
      offWaiting?.();
      offStart?.();
    };
  }, [on, navigate]);

  const handlePlay = () => {
    setStatus('waiting');
    emit('matchmaking:join');
  };

  const handleCancel = () => {
    emit('matchmaking:leave');
    setStatus('idle');
  };

  return (
    <div className="home-page">
      <header>
        <h1>♟ Chess Clone</h1>
        <div className="user-info">
          <span>Hello, {username || user?.email?.split('@')[0] || 'User'}</span>
          <button onClick={signOut}>Log out</button>
        </div>
      </header>

      <main className="lobby">
        {status === 'idle' && (
          <button className="play-btn" onClick={handlePlay}>
            Play Online
          </button>
        )}
        {status === 'waiting' && (
          <div className="waiting">
            <p>Searching for an opponent…</p>
            <button onClick={handleCancel}>Cancel</button>
          </div>
        )}
        {status === 'starting' && <p>Match found! Starting game…</p>}
      </main>
    </div>
  );
}
