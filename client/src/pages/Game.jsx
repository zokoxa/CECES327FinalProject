import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { useAuthStore } from '../store/authStore.js';
import { supabase } from '../lib/supabase.js';
import Board from '../components/Board/Board.jsx';

const FILES = 'abcdefgh';
function toUci({ fromRow, fromCol, toRow, toCol, promotion }) {
  const from = `${FILES[fromCol]}${8 - fromRow}`;
  const to   = `${FILES[toCol]}${8 - toRow}`;
  const promo = promotion ? ['', 'p', 'r', 'n', 'b', 'q', 'k'][promotion] : '';
  return `${from}${to}${promo}`;
}

export default function Game() {
  const { gameId } = useParams();
  const { emit, on } = useSocket();
  const navigate = useNavigate();
  const { state } = useLocation();
  const user = useAuthStore((s) => s.user);

  const [color, setColor] = useState(state?.color ?? null);
  const [players, setPlayers] = useState(
    state ? { white: state.white, black: state.black } : null
  );
  const [moves, setMoves] = useState([]);
  const [gameOver, setGameOver] = useState(null);

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
    const offMove = on('game:move', ({ move }) => {
      setMoves((prev) => [...prev, move]);
    });

    const offOver = on('game:over', ({ result, reason }) => {
      setGameOver({ result, reason });
    });

    return () => {
      offMove?.();
      offOver?.();
    };
  }, [on]);

  // Called by the Board component when the local player makes a legal move
  const handleMove = useCallback((move) => {
    emit('game:move', { gameId, move });
  }, [emit, gameId]);

  const handleResign = () => {
    if (window.confirm('Are you sure you want to resign?')) {
      emit('game:resign', { gameId });
    }
  };

  const handleDrawOffer = () => emit('game:drawOffer', { gameId });

  const handleLocalGameOver = useCallback((result, reason) => {
    emit('game:over', { gameId, result, reason });
  }, [emit, gameId]);

  if (!color) {
    return <div className="loading">Waiting for game info…</div>;
  }

  const opponent = color === 'white' ? players?.black  : players?.white;
  const me       = color === 'white' ? players?.white : players?.black;
  const opponentLabel = color === 'white' ? 'Black' : 'White';
  const myLabel       = color === 'white' ? 'White' : 'Black';

  const isMyTurn = !gameOver && (
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
      <div className="game-header">
        <span>
          {opponent?.username} ({opponentLabel})
          {turnIndicator(!isMyTurn)}
          {!isMyTurn && !gameOver && <span style={{ marginLeft: 6, fontSize: 12, color: '#4caf50' }}>thinking…</span>}
        </span>
      </div>

      <Board
        color={color}
        moves={moves}
        onMove={handleMove}
        onGameOver={handleLocalGameOver}
        disabled={!!gameOver}
      />

      <div className="game-footer">
        <span>
          {me?.username} ({myLabel})
          {turnIndicator(isMyTurn)}
          {isMyTurn && <span style={{ marginLeft: 6, fontSize: 12, color: '#4caf50' }}>your turn</span>}
        </span>
      </div>

      <div className="game-controls">
        <button onClick={handleResign} disabled={!!gameOver}>Resign</button>
        <button onClick={handleDrawOffer} disabled={!!gameOver}>Offer Draw</button>
      </div>

      {gameOver && (() => {
        const isCheckmate  = gameOver.reason === 'checkmate';
        const isDraw       = gameOver.result === 'draw';
        const iWon         = gameOver.result === color;
        const iLost        = !isDraw && !iWon;

        const REASON_LABEL = {
          checkmate:   'Checkmate',
          stalemate:   'Stalemate',
          resignation: 'Resignation',
          agreement:   'Draw by agreement',
          'fifty-move':'50-move rule',
          disconnect:  'Opponent disconnected',
        };

        const headline = isDraw
          ? 'Draw'
          : iWon ? 'You win!' : 'You lose';

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

      <aside className="move-list">
        <h3>Moves</h3>
        <ol>
          {moves.map((m, i) => <li key={i}>{toUci(m)}</li>)}
        </ol>
      </aside>
    </div>
  );
}
