import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import Board from '../components/Board/Board.jsx';

export default function Game() {
  const { gameId } = useParams();
  const { emit, on } = useSocket();
  const navigate = useNavigate();
  const { state } = useLocation();

  const [color, setColor] = useState(state?.color ?? null);
  const [players, setPlayers] = useState(
    state ? { white: state.white, black: state.black } : null
  );
  const [moves, setMoves] = useState([]);
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {

    const offMove = on('game:move', ({ move, moveNumber }) => {
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

  // When your own chess engine detects checkmate / stalemate, call this
  const handleLocalGameOver = useCallback((result, reason) => {
    emit('game:over', { gameId, result, reason });
  }, [emit, gameId]);

  if (!color) {
    return <div className="loading">Waiting for game info…</div>;
  }

  return (
    <div className="game-page">
      <div className="game-header">
        <span>{players?.black?.username} (Black)</span>
      </div>

      {/* ── Drop in your chess board component here ── */}
      <Board
        color={color}
        moves={moves}
        onMove={handleMove}
        onGameOver={handleLocalGameOver}
        disabled={!!gameOver}
      />

      <div className="game-footer">
        <span>{players?.white?.username} (White)</span>
      </div>

      <div className="game-controls">
        <button onClick={handleResign} disabled={!!gameOver}>Resign</button>
        <button onClick={handleDrawOffer} disabled={!!gameOver}>Offer Draw</button>
        {gameOver && (
          <div className="game-over-banner">
            <strong>Game over:</strong> {gameOver.result} — {gameOver.reason}
            <button onClick={() => navigate('/')}>Back to Lobby</button>
          </div>
        )}
      </div>

      <aside className="move-list">
        <h3>Moves</h3>
        <ol>
          {moves.map((m, i) => <li key={i}>{m}</li>)}
        </ol>
      </aside>
    </div>
  );
}
