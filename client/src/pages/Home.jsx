import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { apiUrl, readJsonResponse } from '../lib/api.js';

const LEVEL_NAMES = ['Beginner', 'Novice', 'Amateur', 'Intermediate', 'Club', 'Advanced', 'Expert', 'Master'];

export default function Home() {
  const { username, user, session, signOut } = useAuthStore();
  const { emit, on } = useSocket();
  const [status, setStatus] = useState('idle'); // 'idle' | 'waiting' | 'starting'
  const [level, setLevel] = useState(3);

  // Invite state
  const [inviteInput, setInviteInput]       = useState('');
  const [inviteStatus, setInviteStatus]     = useState(null); // null | 'sending' | 'sent' | 'error'
  const [inviteMsg, setInviteMsg]           = useState('');
  const [inviteTargetId, setInviteTargetId] = useState(null);
  const [incomingInvite, setIncomingInvite] = useState(null); // { fromUsername, fromUserId }
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

    fetch(apiUrl('/api/games/history?limit=10'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (r) => {
        const body = await readJsonResponse(r, 'Failed to load history');
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
    const offWaiting  = on('matchmaking:waiting', () => setStatus('waiting'));
    const offStart    = on('game:start', ({ gameId, color, white, black }) => {
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

    // Invite events
    const offInviteSent      = on('invite:sent',      ({ toUsername, toUserId }) => {
      setInviteStatus('sent');
      setInviteMsg(`Invite sent to ${toUsername}. Waiting for response…`);
      setInviteTargetId(toUserId);
    });
    const offInviteError     = on('invite:error',     ({ message }) => {
      setInviteStatus('error');
      setInviteMsg(message);
    });
    const offInviteIncoming  = on('invite:incoming',  ({ fromUsername, fromUserId }) => {
      setIncomingInvite({ fromUsername, fromUserId });
    });
    const offInviteDeclined  = on('invite:declined',  ({ byUsername }) => {
      setInviteStatus('error');
      setInviteMsg(`${byUsername} declined your invite.`);
    });
    const offInviteCancelled = on('invite:cancelled', () => setIncomingInvite(null));

    return () => {
      offWaiting?.();
      offStart?.();
      offResume?.();
      offInviteSent?.();
      offInviteError?.();
      offInviteIncoming?.();
      offInviteDeclined?.();
      offInviteCancelled?.();
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

  const handleSendInvite = () => {
    const name = inviteInput.trim();
    if (!name) return;
    setInviteStatus('sending');
    setInviteMsg('');
    emit('invite:send', { targetUsername: name });
  };

  const handleCancelInvite = () => {
    if (inviteTargetId) emit('invite:cancel', { targetUserId: inviteTargetId });
    setInviteStatus(null);
    setInviteMsg('');
    setInviteTargetId(null);
  };

  const handleAcceptInvite = () => {
    emit('invite:accept', { fromUserId: incomingInvite.fromUserId });
    setIncomingInvite(null);
  };

  const handleDeclineInvite = () => {
    emit('invite:decline', { fromUserId: incomingInvite.fromUserId });
    setIncomingInvite(null);
  };

  const handleReplayGame = async (gameId) => {
    if (!session?.access_token) return;
    setReplayLoadingId(gameId);

    try {
      const res = await fetch(apiUrl(`/api/games/history/${gameId}/replay`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await readJsonResponse(res, 'Failed to load replay');

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

      <div className="home-body">
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

          <div className="invite-section">
            <h3>Invite a Player</h3>
            <div className="invite-input-row">
              <input
                type="text"
                placeholder="Enter username…"
                value={inviteInput}
                onChange={e => { setInviteInput(e.target.value); setInviteStatus(null); setInviteMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSendInvite()}
                disabled={inviteStatus === 'sending' || inviteStatus === 'sent'}
              />
              {inviteStatus === 'sent'
                ? <button className="invite-cancel-btn" onClick={handleCancelInvite}>Cancel</button>
                : <button className="invite-send-btn" onClick={handleSendInvite} disabled={!inviteInput.trim() || inviteStatus === 'sending' || status !== 'idle'}>Invite</button>
              }
            </div>
            {inviteMsg && (
              <p className={inviteStatus === 'error' ? 'error invite-msg' : 'invite-msg'}>
                {inviteMsg}
              </p>
            )}
          </div>

          <div className="computer-section">
            <h3>Play vs Computer</h3>
            <div className="level-picker">
              <span>Level {level} — {LEVEL_NAMES[level - 1]}</span>
              <input
                type="range" min={1} max={8} value={level}
                onChange={e => setLevel(Number(e.target.value))}
              />
            </div>
            <button
              className="play-btn computer-btn"
              onClick={() => navigate('/computer', { state: { level } })}
              disabled={status !== 'idle'}
            >
              Play vs Computer
            </button>
          </div>
        </main>

        <aside className="history-sidebar">
          <h2 className="sidebar-title">Recent Games</h2>
          {historyLoading && <p className="sidebar-empty">Loading…</p>}
          {historyError  && <p className="sidebar-empty error">{historyError}</p>}
          {!historyLoading && !history.length && !historyError && (
            <p className="sidebar-empty">No games yet.</p>
          )}
          <ul className="sidebar-list">
            {history.map((g) => {
              const opponent = g.color === 'white' ? g.black?.username : g.white?.username;
              const isDraw   = g.result === 'draw';
              const iWon     = !isDraw && g.result === g.color;
              const badge    = isDraw ? 'D' : iWon ? 'W' : 'L';
              const badgeCls = isDraw ? 'badge-draw' : iWon ? 'badge-win' : 'badge-loss';
              return (
                <li key={g.id} className="sidebar-entry">
                  <span className={`result-badge ${badgeCls}`}>{badge}</span>
                  <div className="sidebar-entry-info">
                    <span className="sidebar-opponent">vs {opponent || 'Unknown'}</span>
                    <span className="sidebar-reason">{g.reason || '—'}</span>
                  </div>
                  <button
                    className="sidebar-replay-btn"
                    onClick={() => handleReplayGame(g.id)}
                    disabled={replayLoadingId === g.id}
                  >
                    {replayLoadingId === g.id ? '…' : '▶'}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
      {incomingInvite && (
        <div className="invite-modal-overlay">
          <div className="invite-modal">
            <div className="invite-modal-icon">♟</div>
            <p><strong>{incomingInvite.fromUsername}</strong> invited you to play!</p>
            <div className="invite-modal-buttons">
              <button className="invite-accept-btn" onClick={handleAcceptInvite}>Accept</button>
              <button className="invite-decline-btn" onClick={handleDeclineInvite}>Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
