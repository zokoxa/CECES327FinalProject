import { useState, useEffect } from 'react';

// ── Enums (must match C# ChessMoveType / ChessPieceType) ─────────────────────
const MT = { Normal: 0, CastleQueenSide: 1, CastleKingSide: 2, EnPassant: 3, PawnPromote: 4 };
const PT = { Pawn: 1, Rook: 2, Knight: 3, Bishop: 4, Queen: 5, King: 6 };

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

// Use filled symbols for both sides — color handles the distinction
const SYM = {
  1: '♟', 2: '♜', 3: '♞', 4: '♝', 5: '♛', 6: '♚',
};

// White: cream fill + dark stroke.  Black: dark fill + light stroke.
const PIECE_STYLE = {
  1: { color: '#fffef2', WebkitTextStroke: '1.5px #2c1a0e', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.7))' },
  2: { color: '#1a1008', WebkitTextStroke: '1px #d4b483',   filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))' },
};

// ── Board state helpers ───────────────────────────────────────────────────────

function initBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = [PT.Rook, PT.Knight, PT.Bishop, PT.Queen, PT.King, PT.Bishop, PT.Knight, PT.Rook];
  back.forEach((t, c) => {
    b[0][c] = { p: 2, t }; // black back rank (row 0 = rank 8)
    b[7][c] = { p: 1, t }; // white back rank (row 7 = rank 1)
  });
  for (let c = 0; c < 8; c++) {
    b[1][c] = { p: 2, t: PT.Pawn };
    b[6][c] = { p: 1, t: PT.Pawn };
  }
  return b;
}

function applyMove(b, { fromRow, fromCol, toRow, toCol, type, promotion }) {
  b = b.map(r => [...r]);
  const piece = b[fromRow][fromCol];
  b[fromRow][fromCol] = null;

  if (type === MT.EnPassant) {
    b[fromRow][toCol] = null; // remove captured pawn on same row, dest column
  } else if (type === MT.CastleKingSide) {
    b[fromRow][7] = null;
    b[fromRow][5] = { p: piece.p, t: PT.Rook };
  } else if (type === MT.CastleQueenSide) {
    b[fromRow][0] = null;
    b[fromRow][3] = { p: piece.p, t: PT.Rook };
  }

  b[toRow][toCol] = (type === MT.PawnPromote && promotion)
    ? { p: piece.p, t: promotion }
    : piece;

  return b;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Board({ color, moves, onMove, onGameOver: _onGameOver, disabled }) {
  const [board, setBoard]           = useState(initBoard);
  const [selected, setSelected]     = useState(null);   // { row, col } | null
  const [legalMoves, setLegalMoves] = useState([]);     // MoveDto[] from engine
  const [promoOpts, setPromoOpts]   = useState(null);   // MoveDto[] (promotion choices) | null
  const [lastMove, setLastMove]     = useState(null);   // last MoveDto for highlighting

  const myPlayer = color === 'white' ? 1 : 2;
  const isMyTurn = !disabled && (
    (moves.length % 2 === 0 && color === 'white') ||
    (moves.length % 2 === 1 && color === 'black')
  );

  // Replay all moves to rebuild board state whenever moves array changes
  useEffect(() => {
    let b = initBoard();
    for (const mv of moves) b = applyMove(b, mv);
    setBoard(b);
    setSelected(null);
    setLegalMoves([]);
    setLastMove(moves.length > 0 ? moves[moves.length - 1] : null);
  }, [moves]);

  // Fetch legal moves from server whenever the selected square changes
  useEffect(() => {
    if (!selected || !isMyTurn) { setLegalMoves([]); return; }
    let alive = true;
    const { row, col } = selected;
    fetch(`${SERVER_URL}/api/game/moves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: moves }),
    })
      .then(r => r.json())
      .then(({ moves: legal }) => {
        if (alive) setLegalMoves(legal.filter(m => m.fromRow === row && m.fromCol === col));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [selected, isMyTurn, moves]);

  // ── Click handler ───────────────────────────────────────────────────────────

  const handleSquareClick = (row, col) => {
    if (disabled || promoOpts) return;
    const piece = board[row][col];

    if (selected) {
      const candidates = legalMoves.filter(m => m.toRow === row && m.toCol === col);

      if (candidates.length > 0) {
        if (candidates[0].type === MT.PawnPromote) {
          setPromoOpts(candidates); // show promotion dialog
        } else {
          onMove(candidates[0]);
        }
        setSelected(null);
        setLegalMoves([]);
        return;
      }

      // Re-select own piece, or deselect
      if (piece?.p === myPlayer) {
        setSelected({ row, col });
      } else {
        setSelected(null);
        setLegalMoves([]);
      }
      return;
    }

    if (piece?.p === myPlayer && isMyTurn) {
      setSelected({ row, col });
    }
  };

  const handlePromotion = (pieceType) => {
    const mv = promoOpts?.find(m => m.promotion === pieceType);
    if (mv) onMove(mv);
    setPromoOpts(null);
  };

  // ── Board orientation ───────────────────────────────────────────────────────
  // White: rank 8 (row 0) at top, file a (col 0) on the left
  // Black: rank 1 (row 7) at top, file h (col 7) on the left
  const rows  = color === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const cols  = color === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const files = 'abcdefgh';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', display: 'inline-block', userSelect: 'none' }}>

      {/* Board grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 64px)',
        gridTemplateRows: 'repeat(8, 64px)',
        border: '3px solid #1a1a1a',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      }}>
        {rows.map((row, ri) =>
          cols.map((col, ci) => {
            const light       = (row + col) % 2 === 0;
            const isSel       = selected?.row === row && selected?.col === col;
            const isLegal     = legalMoves.some(m => m.toRow === row && m.toCol === col);
            const isLastFrom  = lastMove?.fromRow === row && lastMove?.fromCol === col;
            const isLastTo    = lastMove?.toRow   === row && lastMove?.toCol   === col;
            const piece       = board[row][col];
            const isCapture   = isLegal && piece !== null;

            let bg = light ? '#f0d9b5' : '#b58863';
            if (isSel)                     bg = light ? '#7fc97f' : '#4e9e4e';
            else if (isLastFrom || isLastTo) bg = light ? '#cdd26a' : '#aaa23a';

            return (
              <div
                key={`${row}-${col}`}
                onClick={() => handleSquareClick(row, col)}
                style={{
                  width: 64, height: 64, background: bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  cursor: (isMyTurn && !disabled) ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
              >
                {/* Rank label — leftmost column */}
                {ci === 0 && (
                  <span style={{
                    position: 'absolute', top: 2, left: 3,
                    fontSize: 11, fontWeight: 700, lineHeight: 1,
                    color: light ? '#b58863' : '#f0d9b5',
                    pointerEvents: 'none',
                  }}>{8 - row}</span>
                )}

                {/* File label — bottom row */}
                {ri === 7 && (
                  <span style={{
                    position: 'absolute', bottom: 2, right: 3,
                    fontSize: 11, fontWeight: 700, lineHeight: 1,
                    color: light ? '#b58863' : '#f0d9b5',
                    pointerEvents: 'none',
                  }}>{files[col]}</span>
                )}

                {/* Legal move: dot for empty square */}
                {isLegal && !piece && (
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.2)',
                    pointerEvents: 'none',
                  }} />
                )}

                {/* Legal move: ring for capture square */}
                {isCapture && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    boxShadow: 'inset 0 0 0 5px rgba(0,0,0,0.25)',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }} />
                )}

                {/* Piece */}
                {piece && (
                  <span style={{
                    fontSize: 46, lineHeight: 1,
                    zIndex: 2, pointerEvents: 'none',
                    ...PIECE_STYLE[piece.p],
                  }}>
                    {SYM[piece.t]}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Promotion dialog */}
      {promoOpts && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, zIndex: 20,
        }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
            Promote pawn to:
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[PT.Queen, PT.Rook, PT.Bishop, PT.Knight].map(pt => (
              <button
                key={pt}
                onClick={() => handlePromotion(pt)}
                style={{
                  width: 64, height: 64, fontSize: 44, lineHeight: 1,
                  background: '#f0d9b5', border: '2px solid #b58863',
                  borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...PIECE_STYLE[myPlayer],
                }}
              >
                {SYM[pt]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
