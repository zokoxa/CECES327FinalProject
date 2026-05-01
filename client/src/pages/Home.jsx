import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { apiUrl, readJsonResponse } from '../lib/api.js';

const LEVEL_NAMES = ['Beginner', 'Novice', 'Amateur', 'Intermediate', 'Club', 'Advanced', 'Expert', 'Master'];

export default function Home() {
  const { username, user, session, signOut } = useAuthStore();
  const { emit, on } = useSocket();
  const [status, setStatus] = useState('idle');
  const [level, setLevel] = useState(3);

  // Invite state
  const [inviteInput, setInviteInput]       = useState('');
  const [inviteStatus, setInviteStatus]     = useState(null);
  const [inviteMsg, setInviteMsg]           = useState('');
  const [inviteTargetId, setInviteTargetId] = useState(null);
  const [incomingInvite, setIncomingInvite] = useState(null);

  // History state
  const [history, setHistory]               = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError]     = useState('');
  const [replayLoadingId, setReplayLoadingId] = useState(null);

  // Friends state
  const [friends, setFriends]               = useState([]);
  const [pendingIncoming, setPendingIncoming] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addFriendStatus, setAddFriendStatus] = useState(null);
  const [addFriendMsg, setAddFriendMsg]     = useState('');

  const [leftOpen, setLeftOpen]   = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const navigate = useNavigate();

  // ── Fetch game history ────────────────────────────────────────────────────
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
      .catch((err) => { if (alive) setHistoryError(err.message || 'Failed to load history'); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [session?.access_token]);

  // ── Fetch friends ─────────────────────────────────────────────────────────
  const fetchFriends = useCallback(async () => {
    if (!session?.access_token) return;
    setFriendsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/friends'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await readJsonResponse(res, 'Failed to load friends');
      setFriends(body.friends || []);
      setPendingIncoming(body.pendingIncoming || []);
    } catch {
      // silently fail
    } finally {
      setFriendsLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchFriends();
    const interval = setInterval(fetchFriends, 30000);
    return () => clearInterval(interval);
  }, [fetchFriends]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const offWaiting  = on('matchmaking:waiting', () => setStatus('waiting'));
    const offStart    = on('game:start', ({ gameId, color, white, black }) => {
      setStatus('starting');
      navigate(`/game/${gameId}`, { state: { color, white, black } });
    });
    const offResume = on('game:resume', ({ gameId, color, white, black, moves }) => {
      navigate(`/game/${gameId}`, { state: { color, white, black, moves, resumed: true } });
    });

    emit('game:reconnectRequest');

    const offInviteSent      = on('invite:sent', ({ toUsername, toUserId }) => {
      setInviteStatus('sent');
      setInviteMsg(`Invite sent to ${toUsername}. Waiting for response…`);
      setInviteTargetId(toUserId);
    });
    const offInviteError     = on('invite:error', ({ message }) => {
      setInviteStatus('error');
      setInviteMsg(message);
    });
    const offInviteIncoming  = on('invite:incoming', ({ fromUsername, fromUserId }) => {
      setIncomingInvite({ fromUsername, fromUserId });
    });
    const offInviteDeclined  = on('invite:declined', ({ byUsername }) => {
      setInviteStatus('error');
      setInviteMsg(`${byUsername} declined your invite.`);
    });
    const offInviteCancelled = on('invite:cancelled', () => setIncomingInvite(null));

    const offFriendRequest = on('friend:request', ({ id, username }) => {
      setPendingIncoming((prev) => prev.some(r => r.id === id) ? prev : [...prev, { id, username }]);
    });

    const offFriendAccepted = on('friend:accepted', ({ id, username }) => {
      setFriends((prev) => prev.some(f => f.id === id) ? prev : [...prev, { id, username, online: true }]);
    });

    return () => {
      offWaiting?.(); offStart?.(); offResume?.();
      offInviteSent?.(); offInviteError?.(); offInviteIncoming?.();
      offInviteDeclined?.(); offInviteCancelled?.();
      offFriendRequest?.(); offFriendAccepted?.();
    };
  }, [on, emit, navigate]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePlay        = () => { setStatus('waiting'); emit('matchmaking:join'); };
  const handleCancel      = () => { emit('matchmaking:leave'); setStatus('idle'); };

  const handleSendInvite  = (targetUsername) => {
    const name = (targetUsername ?? inviteInput).trim();
    if (!name) return;
    setInviteStatus('sending');
    setInviteMsg('');
    emit('invite:send', { targetUsername: name });
  };

  const handleCancelInvite = () => {
    if (inviteTargetId) emit('invite:cancel', { targetUserId: inviteTargetId });
    setInviteStatus(null); setInviteMsg(''); setInviteTargetId(null);
  };

  const handleAcceptInvite = () => {
    emit('invite:accept', { fromUserId: incomingInvite.fromUserId });
    setIncomingInvite(null);
  };

  const handleDeclineInvite = () => {
    emit('invite:decline', { fromUserId: incomingInvite.fromUserId });
    setIncomingInvite(null);
  };

  const handleAddFriend = async () => {
    const name = inviteInput.trim();
    if (!name) return;
    setAddFriendStatus('sending');
    setAddFriendMsg('');
    try {
      const res = await fetch(apiUrl('/api/friends/request'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUsername: name }),
      });
      const body = await readJsonResponse(res, 'Failed to send friend request');
      setAddFriendStatus('success');
      setAddFriendMsg(body.message);
      fetchFriends();
    } catch (err) {
      setAddFriendStatus('error');
      setAddFriendMsg(err.message);
    }
  };

  const handleAcceptFriend = async (requesterId) => {
    try {
      const res = await fetch(apiUrl('/api/friends/accept'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId }),
      });
      await readJsonResponse(res, 'Failed to accept');
      fetchFriends();
    } catch {}
  };

  const handleRemoveFriend = async (userId) => {
    try {
      await fetch(apiUrl(`/api/friends/${userId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      fetchFriends();
    } catch {}
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
          color: body.game.color, white: body.game.white, black: body.game.black,
          moves: body.moves, historyReplay: true,
          gameOver: { result: body.game.result, reason: body.game.reason },
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

      <div
        className="home-body"
        style={{ gridTemplateColumns: `${leftOpen ? '240px' : '36px'} 1fr ${rightOpen ? '280px' : '36px'}` }}
      >
        {/* ── Friends sidebar (left) ── */}
        <aside className={`friends-sidebar${leftOpen ? '' : ' sidebar-collapsed'}`}>
          <div className="sidebar-header">
            {leftOpen && <h2 className="sidebar-title">Friends</h2>}
            <button className="sidebar-toggle" onClick={() => setLeftOpen(o => !o)} title={leftOpen ? 'Collapse' : 'Expand'}>
              {leftOpen ? '◀' : '▶'}
            </button>
          </div>
          {!leftOpen && <span className="sidebar-collapsed-label">Friends</span>}

          {leftOpen && pendingIncoming.length > 0 && (
            <>
              <div className="sidebar-title" style={{ marginTop: '0.5rem', color: '#e0c97f' }}>
                Requests ({pendingIncoming.length})
              </div>
              <ul className="sidebar-list">
                {pendingIncoming.map((req) => (
                  <li key={req.id} className="friend-entry" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
                    <span className="sidebar-opponent">{req.username}</span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => handleAcceptFriend(req.id)}
                        style={{ padding: '0.2rem 0.55rem', background: '#4caf50', border: 'none', borderRadius: 4, color: '#111', fontWeight: 700, cursor: 'pointer', fontSize: '0.72rem' }}
                      >Accept</button>
                      <button
                        onClick={() => handleRemoveFriend(req.id)}
                        style={{ padding: '0.2rem 0.55rem', background: '#333', border: '1px solid #555', borderRadius: 4, color: '#ccc', fontWeight: 600, cursor: 'pointer', fontSize: '0.72rem' }}
                      >Decline</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {leftOpen && (friendsLoading && !friends.length ? (
            <p className="sidebar-empty">Loading…</p>
          ) : !friends.length && !pendingIncoming.length ? (
            <p className="sidebar-empty">No friends yet.</p>
          ) : friends.length > 0 ? (
            <ul className="sidebar-list" style={{ marginTop: pendingIncoming.length ? '0.5rem' : 0 }}>
              {friends.map((f) => (
                <li key={f.id} className="friend-entry">
                  <span className={`friend-dot ${f.online ? 'online' : 'offline'}`} />
                  <div className="sidebar-entry-info">
                    <span className="sidebar-opponent">{f.username}</span>
                  </div>
                  {f.online && (
                    <button
                      className="friend-invite-btn"
                      onClick={() => handleSendInvite(f.username)}
                      disabled={inviteStatus === 'sent' || status !== 'idle'}
                    >
                      Invite
                    </button>
                  )}
                  <button
                    className="friend-remove-btn"
                    onClick={() => handleRemoveFriend(f.id)}
                    title="Remove friend"
                  >×</button>
                </li>
              ))}
            </ul>
          ) : null)}
        </aside>

        {/* ── Main lobby ── */}
        <main className="lobby">
          {status === 'idle' && (
            <button className="play-btn" onClick={handlePlay}>Play Online</button>
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
                onChange={e => { setInviteInput(e.target.value); setInviteStatus(null); setInviteMsg(''); setAddFriendStatus(null); setAddFriendMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSendInvite()}
                disabled={inviteStatus === 'sending' || inviteStatus === 'sent'}
              />
              {inviteStatus === 'sent' ? (
                <button className="invite-cancel-btn" onClick={handleCancelInvite}>Cancel</button>
              ) : (
                <>
                  <button
                    className="invite-send-btn"
                    onClick={() => handleSendInvite()}
                    disabled={!inviteInput.trim() || inviteStatus === 'sending' || status !== 'idle'}
                  >
                    Invite
                  </button>
                  <button
                    className="add-friend-btn"
                    onClick={handleAddFriend}
                    disabled={!inviteInput.trim() || addFriendStatus === 'sending'}
                  >
                    + Friend
                  </button>
                </>
              )}
            </div>
            {inviteMsg && (
              <p className={inviteStatus === 'error' ? 'error invite-msg' : 'invite-msg'}>{inviteMsg}</p>
            )}
            {addFriendMsg && (
              <p className={addFriendStatus === 'error' ? 'error invite-msg' : 'invite-msg'}>{addFriendMsg}</p>
            )}
          </div>

          <div className="computer-section">
            <h3>Play vs Computer</h3>
            <div className="level-picker">
              <span>Level {level} — {LEVEL_NAMES[level - 1]}</span>
              <input type="range" min={1} max={8} value={level} onChange={e => setLevel(Number(e.target.value))} />
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

        {/* ── History sidebar (right) ── */}
        <aside className={`history-sidebar${rightOpen ? '' : ' sidebar-collapsed'}`}>
          <div className="sidebar-header">
            <button className="sidebar-toggle" onClick={() => setRightOpen(o => !o)} title={rightOpen ? 'Collapse' : 'Expand'}>
              {rightOpen ? '▶' : '◀'}
            </button>
            {rightOpen && <h2 className="sidebar-title">Recent Games</h2>}
          </div>
          {!rightOpen && <span className="sidebar-collapsed-label">Recent Games</span>}
          {rightOpen && (
            <>
              {historyLoading && <p className="sidebar-empty">Loading…</p>}
              {historyError   && <p className="sidebar-empty error">{historyError}</p>}
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
            </>
          )}
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
