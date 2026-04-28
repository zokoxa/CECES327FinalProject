import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { useSocket } from '../hooks/useSocket.js';

export default function Home() {
  const { username, user, session, signOut } = useAuthStore();
  const { emit, on } = useSocket();
  const [status, setStatus] = useState('idle'); // 'idle' | 'waiting' | 'starting'
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [replayLoadingId, setReplayLoadingId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!session?.access_token) return;

    let alive = true;
    setHistoryLoading(true);
    setHistoryError('');

    fetch('/api/games/history?limit=5', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || 'Failed to load history');
        if (alive) setHistory(body.games || []);
      })
      .catch((err) => {
        if (alive) setHistoryError(err.message || 'Failed to load history');
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });

    return () => { alive = false; };
  }, [session?.access_token]);

  useEffect(() => {
    // Listen for matchmaking events
    const offWaiting = on('matchmaking:waiting', () => setStatus('waiting'));
    const offStart = on('game:start', ({ gameId, color, white, black }) => {
      setStatus('starting');
      navigate(`/game/${gameId}`, { state: { color, white, black } });
    });
    // Recovery: resume an existing game if one is found
    const offResume = on('game:resume', ({ gameId, color, white, black, moves }) => {
      navigate(`/game/${gameId}`, {
        state: { color, white, black, moves, resumed: true },
      });
    });

    // Ask server whether this user has a recoverable game
    emit('game:reconnectRequest');

    return () => {
      offWaiting?.();
      offStart?.();
      offResume?.();
    };
  }, [on, emit, navigate]);

  const handlePlay = () => {
    setStatus('waiting');
    emit('matchmaking:join');
  };

  const handleCancel = () => {
    emit('matchmaking:leave');
    setStatus('idle');
  };

  const handleReplayGame = async (gameId) => {
    if (!session?.access_token) return;
    setReplayLoadingId(gameId);

    try {
      const res = await fetch(`/api/games/history/${gameId}/replay`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to load replay');

      navigate(`/game/${gameId}`, {
        state: {
          color: body.game.color,
          white: body.game.white,
          black: body.game.black,
          moves: body.moves,
          historyReplay: true,
          gameOver: {
            result: body.game.result,
            reason: body.game.reason,
          },
        },
      });
    } catch (err) {
      setHistoryError(err.message || 'Failed to load replay');
    } finally {
      setReplayLoadingId(null);
    }
  };

  return (
    <div className="home-page">
      <header>
        <h1>♟ Chessmate</h1>
        <div className="user-info">
          <span>Hello, {username || user?.email?.split('@')[0] || 'User'}</span>
          <button className="logout-btn" onClick={signOut}>Log out</button>
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

        <section className="history-panel">
          <h3>Recent Finished Games</h3>
          {historyLoading && <p>Loading history...</p>}
          {historyError && <p className="error">{historyError}</p>}
          {!historyLoading && !history.length && !historyError && (
            <p>No finished games yet.</p>
          )}
          {!!history.length && (
            <ul className="history-list">
              {history.map((g) => {
                const opponent = g.color === 'white' ? g.black?.username : g.white?.username;
                return (
                  <li key={g.id}>
                    <div>
                      <strong>vs {opponent || 'Unknown'}</strong>
                      <span>Result: {g.result || 'n/a'}</span>
                    </div>
                    <button
                      onClick={() => handleReplayGame(g.id)}
                      disabled={replayLoadingId === g.id}
                    >
                      {replayLoadingId === g.id ? 'Loading...' : 'Replay'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
