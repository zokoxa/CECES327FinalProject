import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { useReplay } from '../hooks/useReplay.js';
import { useStockfish, fromUci } from '../hooks/useStockfish.js';
import Board from '../components/Board/Board.jsx';
import ReplayPanel from '../components/Replay/ReplayPanel.jsx';

const LEVEL_NAMES = ['Beginner', 'Novice', 'Amateur', 'Intermediate', 'Club', 'Advanced', 'Expert', 'Master'];
const SERVER_URL  = import.meta.env.VITE_SERVER_URL || '';

const REASON_LABEL = {
  checkmate:   'Checkmate',
  stalemate:   'Stalemate',
  resignation: 'Resignation',
  'fifty-move':'50-move rule',
};

async function apiValidate(history, move) {
  const res = await fetch(`${SERVER_URL}/api/game/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, move }),
  });
  return res.json();
}

async function apiLegalMoves(history) {
  const res = await fetch(`${SERVER_URL}/api/game/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history }),
  });
  const data = await res.json();
  return data.moves ?? [];
}

export default function LocalGame() {
  const navigate          = useNavigate();
  const { state }         = useLocation();
  const { username }      = useAuthStore();
  const { getBestMove }   = useStockfish();

  const level     = state?.level ?? 3;
  const levelName = LEVEL_NAMES[level - 1] ?? '';

  const [moves, setMoves]         = useState([]);
  const [gameOver, setGameOver]   = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [botThinking, setBotThinking] = useState(false);

  const { replayIndex, replayMoves, isReplayMode, jumpStart, stepBack, stepForward, jumpEnd, jumpToMove } =
    useReplay(moves);

  const replayEnabled  = !!gameOver;
  const boardMoves     = replayEnabled ? replayMoves : moves;
  const boardDisabled  = !!gameOver || botThinking || (replayEnabled && isReplayMode);
  const isMyTurn       = !gameOver && !botThinking && moves.length % 2 === 0;

  const applyBotMove = useCallback(async (currentMoves) => {
    setBotThinking(true);
    try {
      const uciStr = await getBestMove(currentMoves, level);
      if (!uciStr) return;

      const partial = fromUci(uciStr);
      const legal   = await apiLegalMoves(currentMoves);

      const botMove = legal.find(m =>
        m.fromRow === partial.fromRow &&
        m.fromCol === partial.fromCol &&
        m.toRow   === partial.toRow   &&
        m.toCol   === partial.toCol   &&
        (!partial.promotion || m.promotion === partial.promotion)
      );
      if (!botMove) return;

      const result    = await apiValidate(currentMoves, botMove);
      if (!result.valid) return;

      const nextMoves = [...currentMoves, botMove];
      setMoves(nextMoves);

      if (result.isCheckmate) {
        setGameOver({ result: 'black', reason: 'checkmate' });
      } else if (result.isDraw) {
        setGameOver({ result: 'draw', reason: result.isStalemate ? 'stalemate' : 'fifty-move' });
      }
    } catch (err) {
      console.error('Bot move error:', err);
    } finally {
      setBotThinking(false);
    }
  }, [getBestMove, level]);

  const handleMove = useCallback(async (moveDto) => {
    if (botThinking || gameOver) return;

    const result = await apiValidate(moves, moveDto);
    if (!result.valid) return;

    const newMoves = [...moves, moveDto];
    setMoves(newMoves);

    if (result.isCheckmate) {
      setGameOver({ result: 'white', reason: 'checkmate' });
      return;
    }
    if (result.isDraw) {
      setGameOver({ result: 'draw', reason: result.isStalemate ? 'stalemate' : 'fifty-move' });
      return;
    }

    applyBotMove(newMoves);
  }, [moves, gameOver, botThinking, applyBotMove]);

  const handleResign = () => {
    if (window.confirm('Resign this game?')) {
      setGameOver({ result: 'black', reason: 'resignation' });
    }
  };

  useEffect(() => {
    if (gameOver) setShowModal(true);
  }, [gameOver]);

  const dot = (active) => active ? (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: '#4caf50', marginLeft: 8, boxShadow: '0 0 6px #4caf50',
    }} />
  ) : null;

  const iWon   = gameOver?.result === 'white';
  const isDraw = gameOver?.result === 'draw';
  const accentColor = !gameOver ? '#4caf50' : isDraw ? '#f0c040' : iWon ? '#4caf50' : '#e53935';

  return (
    <div className="game-page">
      <div className="game-header">
        <span>
          Stockfish — Level {level} ({levelName})
          {dot(!isMyTurn && !gameOver)}
          {botThinking && <span style={{ marginLeft: 8, fontSize: 12, color: '#4caf50' }}>thinking…</span>}
        </span>
      </div>

      <Board
        color="white"
        moves={boardMoves}
        onMove={handleMove}
        disabled={boardDisabled}
      />

      <div className="game-footer">
        <span>
          {username || 'You'} (White)
          {dot(isMyTurn)}
          {isMyTurn && <span style={{ marginLeft: 8, fontSize: 12, color: '#4caf50' }}>your turn</span>}
        </span>
      </div>

      <div className="game-controls">
        <button onClick={handleResign} disabled={!!gameOver || botThinking}>Resign</button>
        <button onClick={() => navigate('/')}>Home</button>
      </div>

      {replayEnabled && (
        <ReplayPanel
          moves={moves}
          replayIndex={replayIndex}
          isReplayMode={isReplayMode}
          onJumpStart={jumpStart}
          onStepBack={stepBack}
          onStepForward={stepForward}
          onJumpEnd={jumpEnd}
          onJumpToMove={jumpToMove}
        />
      )}

      {gameOver && showModal && (
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
            <div style={{ fontSize: 56, marginBottom: 8 }}>
              {isDraw ? '½' : iWon ? '♔' : '♚'}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: accentColor, letterSpacing: 1, marginBottom: 6 }}>
              {isDraw ? 'Draw' : iWon ? 'You win!' : 'You lose'}
            </div>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 28 }}>
              {REASON_LABEL[gameOver.reason] ?? gameOver.reason}
            </div>
            <button
              onClick={() => setShowModal(false)}
              style={{
                background: '#555', color: '#fff',
                border: 'none', borderRadius: 6,
                padding: '10px 24px', fontSize: 15,
                fontWeight: 700, cursor: 'pointer', marginRight: 10,
              }}
            >
              Review
            </button>
            <button
              onClick={() => navigate('/')}
              style={{
                background: accentColor, color: '#000',
                border: 'none', borderRadius: 6,
                padding: '10px 24px', fontSize: 15,
                fontWeight: 700, cursor: 'pointer',
              }}
            >
              Back to Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
