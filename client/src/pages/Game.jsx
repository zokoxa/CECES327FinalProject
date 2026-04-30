import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { useReplay } from '../hooks/useReplay.js';
import { useAuthStore } from '../store/authStore.js';
import { supabase } from '../lib/supabase.js';
import Board from '../components/Board/Board.jsx';
import ReplayPanel from '../components/Replay/ReplayPanel.jsx';

export default function Game() {
  const { gameId } = useParams();
  const { emit, on } = useSocket();
  const navigate = useNavigate();
  const { state } = useLocation();
  const user = useAuthStore((s) => s.user);
  const historyReplay = !!state?.historyReplay;

  const [color, setColor] = useState(state?.color ?? null);
  const [players, setPlayers] = useState(
    state ? { white: state.white, black: state.black } : null
  );
  const [moves, setMoves] = useState(state?.moves || []);
  const [gameOver, setGameOver] = useState(state?.gameOver ?? null);
  const [showGameOverModal, setShowGameOverModal] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseMessage, setPauseMessage] = useState('');
  const [graceUntil, setGraceUntil] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [incomingDrawOffer, setIncomingDrawOffer] = useState(null);
  const [drawNotice, setDrawNotice] = useState('');

  const {
    replayIndex,
    replayMoves,
    isReplayMode,
    jumpStart,
    stepBack,
    stepForward,
    jumpEnd,
    jumpToMove,
  } = useReplay(moves, (state?.moves || []).length);

  // Fallback: if location.state was missing (edge case — socket reconnect
  // during matchmaking), fetch color and player info directly from Supabase.
  useEffect(() => {
    if (color || !user) return;
    (async () => {
      const { data: game } = await supabase
        .from('games')
        .select('white_id, black_id')
        .eq('id', gameId)
        .single();
      if (!game) return;

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', [game.white_id, game.black_id]);
      if (!profiles) return;

      const white = profiles.find(p => p.id === game.white_id);
      const black = profiles.find(p => p.id === game.black_id);
      setColor(game.white_id === user.id ? 'white' : 'black');
      setPlayers({ white, black });
    })();
  }, [gameId, color, user]);

  useEffect(() => {
    if (historyReplay) return;
    emit('game:reconnectRequest');
  }, [emit, historyReplay]);

  useEffect(() => {
    if (historyReplay) return;

    const offMove = on('game:move', ({ move }) => {
      setMoves((prev) => [...prev, move]);
    });

    const offDrawOffer = on('game:drawOffer', ({ offeredByUsername } = {}) => {
      setIncomingDrawOffer({ offeredByUsername: offeredByUsername || 'Your opponent' });
    });

    const offDrawOfferSent = on('game:drawOfferSent', () => {
      setDrawNotice('Draw offer sent. Waiting for opponent response...');
    });

    const offDrawDeclined = on('game:drawDeclined', () => {
      setDrawNotice('Your draw offer was declined.');
    });

    const offOver = on('game:over', ({ result, reason }) => {
      setGameOver({ result, reason });
      setIncomingDrawOffer(null);
      setDrawNotice('');
    });

    const offPaused = on('game:paused', ({ disconnectedColor, graceUntil }) => {
      setPaused(true);
      setGraceUntil(graceUntil);
      setPauseMessage(`Player ${disconnectedColor} disconnected. Waiting for reconnection...`);
    });

    const offPlayerReconnected = on('game:playerReconnected', ({ color }) => {
      setPauseMessage(`Player ${color} reconnected.`);
    });

    const offResumed = on('game:resumed', () => {
      setPaused(false);
      setPauseMessage('');
      setGraceUntil(null);
      setTimeLeft('');
    });

    const offResume = on('game:resume', ({ color, white, black, moves, status, graceUntil }) => {
      setColor(color);
      setPlayers({ white, black });
      setMoves(moves || []);
      setPaused(status === 'paused');
      setGraceUntil(status === 'paused' ? graceUntil : null);

      if (status !== 'paused') {
        setPauseMessage('');
        setTimeLeft('');
      }
    });

    const offReconnectNotFound = on('game:reconnectNotFound', () => {
      console.log('No recoverable game found');
    });

    const offConnect = on('connect', () => {
      console.log('[CLIENT] socket connected/reconnected, requesting game recovery');
      emit('game:reconnectRequest');
    });

    return () => {
      offMove?.();
      offDrawOffer?.();
      offDrawOfferSent?.();
      offDrawDeclined?.();
      offOver?.();
      offPaused?.();
      offPlayerReconnected?.();
      offResumed?.();
      offResume?.();
      offReconnectNotFound?.();
      offConnect?.();
    };
  }, [on, historyReplay, emit]);

  useEffect(() => {
    if (gameOver && !historyReplay) setShowGameOverModal(true);
  }, [gameOver, historyReplay]);

  useEffect(() => {
    if (!drawNotice) return;
    const timeout = setTimeout(() => setDrawNotice(''), 3500);
    return () => clearTimeout(timeout);
  }, [drawNotice]);

  useEffect(() => {
    if (!paused || !graceUntil) {
      setTimeLeft('');
      return;
    }
    const updateTimer = () => {
      const msLeft = graceUntil - Date.now();
      if (msLeft <= 0) {
        setTimeLeft('Ending game...');
        return;
      }
      const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setTimeLeft(`${minutes}:${String(seconds).padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [paused, graceUntil]);

  const handleMove = useCallback((move) => {
    emit('game:move', { gameId, move });
  }, [emit, gameId]);

  const handleResign = () => {
    if (window.confirm('Are you sure you want to resign?')) {
      emit('game:resign', { gameId });
    }
  };

  const handleDrawOffer = () => emit('game:drawOffer', { gameId });

  const handleAcceptDrawOffer = () => {
    emit('game:drawAccept', { gameId });
    setIncomingDrawOffer(null);
  };

  const handleDeclineDrawOffer = () => {
    emit('game:drawDecline', { gameId });
    setIncomingDrawOffer(null);
  };

  const handleLocalGameOver = useCallback((result, reason) => {
    emit('game:over', { gameId, result, reason });
  }, [emit, gameId]);

  if (!color) {
    return <div className="loading">Waiting for game info…</div>;
  }

  const opponent      = color === 'white' ? players?.black  : players?.white;
  const me            = color === 'white' ? players?.white  : players?.black;
  const opponentLabel = color === 'white' ? 'Black' : 'White';
  const myLabel       = color === 'white' ? 'White' : 'Black';
  const replayEnabled = historyReplay || !!gameOver;
  const boardMoves = replayEnabled ? replayMoves : moves;
  const boardInReplayMode = replayEnabled && isReplayMode;

  const isMyTurn = !gameOver && !paused && (
    (moves.length % 2 === 0 && color === 'white') ||
    (moves.length % 2 === 1 && color === 'black')
  );

  const turnIndicator = (active) => active ? (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: '#4caf50', marginLeft: 8, boxShadow: '0 0 6px #4caf50',
    }} title="Your turn" />
  ) : null;

  return (
      <div className="game-page">
        {pauseMessage && (
          <div style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: '#2a2a2a',
            border: '1px solid #555',
            borderRadius: 8,
            color: '#fff',
            textAlign: 'center',
        }}>
            <div>{pauseMessage}</div>
            {paused && timeLeft && (
              <div style={{ marginTop: 6, fontSize: 14, color: '#e3242b', fontWeight: 700 }}>
                Time remaining: {timeLeft}
              </div>
            )}
          </div>
        )}
        {drawNotice && (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%',
            transform: 'translateX(-50%)',
            background: '#242b36',
            border: '1px solid #4e5f7d',
            borderRadius: 8,
            padding: '10px 20px',
            color: '#e6ecff',
            zIndex: 200,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            {drawNotice}
          </div>
        )}
      <div className="game-header">
        <span>
          {opponent?.username} ({opponentLabel})
          {turnIndicator(!isMyTurn)}
          {!isMyTurn && !gameOver && <span style={{ marginLeft: 6, fontSize: 12, color: '#4caf50' }}>thinking…</span>}
        </span>
        {historyReplay && (
          <button onClick={() => navigate('/')} style={{ marginLeft: 'auto', padding: '0.35rem 1rem', border: 'none', borderRadius: 6, background: '#444', color: '#f0f0f0', cursor: 'pointer', fontSize: 13 }}>
            ← Home
          </button>
        )}
      </div>

      <Board
        color={color}
        moves={boardMoves}
        onMove={handleMove}
        onGameOver={handleLocalGameOver}
        disabled={historyReplay || !!gameOver || paused || boardInReplayMode}
      />

      <div className="game-footer">
        <span>
          {me?.username} ({myLabel})
          {turnIndicator(isMyTurn)}
          {isMyTurn && <span style={{ marginLeft: 6, fontSize: 12, color: '#4caf50' }}>your turn</span>}
        </span>
      </div>

      {!historyReplay && (
        <div className="game-controls">
          <button onClick={handleResign} disabled={!!gameOver || paused}>Resign</button>
          <button onClick={handleDrawOffer} disabled={!!gameOver || paused || !!incomingDrawOffer}>Offer Draw</button>
        </div>
      )}

      {incomingDrawOffer && !gameOver && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: '#1e1e1e',
          border: '1px solid #505050',
          borderRadius: 10,
          padding: '14px 18px',
          zIndex: 200,
          minWidth: 240,
        }}>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: 10 }}>
            ½ {incomingDrawOffer.offeredByUsername} offered a draw
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAcceptDrawOffer}
              style={{
                flex: 1, background: '#4caf50', color: '#111',
                border: 'none', borderRadius: 6,
                padding: '6px 0', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Accept
            </button>
            <button
              onClick={handleDeclineDrawOffer}
              style={{
                flex: 1, background: '#333', color: '#e0e0e0',
                border: '1px solid #555', borderRadius: 6,
                padding: '6px 0', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <ReplayPanel
        moves={moves}
        replayIndex={replayIndex}
        isReplayMode={isReplayMode}
        replayEnabled={replayEnabled}
        onJumpStart={jumpStart}
        onStepBack={stepBack}
        onStepForward={stepForward}
        onJumpEnd={jumpEnd}
        onJumpToMove={jumpToMove}
      />

      {gameOver && showGameOverModal && !historyReplay && (() => {
        const isCheckmate = gameOver.reason === 'checkmate';
        const isDraw      = gameOver.result === 'draw';
        const iWon        = gameOver.result === color;
        const iLost       = !isDraw && !iWon;

        const REASON_LABEL = {
          checkmate:   'Checkmate',
          stalemate:   'Stalemate',
          resignation: 'Resignation',
          agreement:   'Draw by agreement',
          'fifty-move':'50-move rule',
          disconnect:  'Opponent disconnected',
          disconnect_timeout: 'Opponent failed to reconnect in time',
          abandonment: 'Game abandoned',
        };

        const headline    = isDraw ? 'Draw' : iWon ? 'You win!' : 'You lose';
        const accentColor = isDraw ? '#f0c040' : iWon ? '#4caf50' : '#e53935';
        const icon        = isDraw ? '½' : iWon ? '♔' : '♚';

        return (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100,
          }}>
            <div style={{
              background: '#1e1e1e',
              border: `2px solid ${accentColor}`,
              borderRadius: 12,
              padding: '40px 56px',
              textAlign: 'center',
              boxShadow: `0 0 40px ${accentColor}55`,
              minWidth: 300,
            }}>
              <div style={{ fontSize: 56, marginBottom: 8 }}>{icon}</div>
              <div style={{
                fontSize: 36, fontWeight: 800, color: accentColor,
                letterSpacing: 1, marginBottom: 6,
              }}>
                {headline}
              </div>
              {isCheckmate && (
                <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginBottom: 4 }}>
                  {iLost ? 'Your king has been checkmated' : 'You checkmated your opponent'}
                </div>
              )}
              <div style={{ fontSize: 13, color: '#aaa', marginBottom: 28 }}>
                {REASON_LABEL[gameOver.reason] ?? gameOver.reason}
              </div>
              <button
                onClick={() => setShowGameOverModal(false)}
                style={{
                  background: '#888', color: '#111',
                  border: 'none', borderRadius: 6,
                  padding: '10px 28px', fontSize: 15,
                  fontWeight: 700, cursor: 'pointer',
                  marginRight: 10,
                }}
              >
                Review Replay
              </button>
              <button
                onClick={() => navigate('/')}
                style={{
                  background: accentColor, color: '#000',
                  border: 'none', borderRadius: 6,
                  padding: '10px 28px', fontSize: 15,
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                Back to Lobby
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
