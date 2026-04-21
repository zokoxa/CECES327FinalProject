import { useState, useEffect, useRef } from 'react';

// ── Enums (must match C# ChessMoveType / ChessPieceType) ─────────────────────
const MT = { Normal: 0, CastleQueenSide: 1, CastleKingSide: 2, EnPassant: 3, PawnPromote: 4 };
const PT = { Pawn: 1, Rook: 2, Knight: 3, Bishop: 4, Queen: 5, King: 6 };

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

// Maps player (1=white, 2=black) + piece type → SVG filename under /pieces/
const PIECE_IMG = {
  1: { 1: 'wP', 2: 'wR', 3: 'wN', 4: 'wB', 5: 'wQ', 6: 'wK' },
  2: { 1: 'bP', 2: 'bR', 3: 'bN', 4: 'bB', 5: 'bQ', 6: 'bK' },
};
const pieceImg = (p, t) => `/pieces/${PIECE_IMG[p][t]}.svg`;

const ANIM_MS = 180;
const SQUARE  = 64;
const BORDER  = 3;

// ── Board state helpers ───────────────────────────────────────────────────────

function initBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = [PT.Rook, PT.Knight, PT.Bishop, PT.Queen, PT.King, PT.Bishop, PT.Knight, PT.Rook];
  back.forEach((t, c) => {
    b[0][c] = { p: 2, t };
    b[7][c] = { p: 1, t };
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
    b[fromRow][toCol] = null;
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

// ── Animated piece overlay ────────────────────────────────────────────────────

// Renders a single piece that slides from (fromX,fromY) to (toX,toY).
// `active` controls whether the translate is applied — toggled after mount
// via requestAnimationFrame so the CSS transition actually fires.
function AnimPiece({ piece, fromX, fromY, toX, toY }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setActive(true))
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  const dx = toX - fromX;
  const dy = toY - fromY;

  return (
    <div style={{
      position: 'absolute',
      left: fromX + BORDER,
      top:  fromY + BORDER,
      width: SQUARE, height: SQUARE,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 10,
      transform: active ? `translate(${dx}px,${dy}px)` : 'translate(0,0)',
      transition: active ? `transform ${ANIM_MS}ms ease-in-out` : 'none',
    }}>
      <img src={pieceImg(piece.p, piece.t)} style={{ width: 52, height: 52 }} draggable={false} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Board({ color, moves, onMove, onGameOver: _onGameOver, disabled }) {
  const [board, setBoard]           = useState(initBoard);
  const [selected, setSelected]     = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [promoOpts, setPromoOpts]   = useState(null);
  const [lastMove, setLastMove]     = useState(null);

  // animSlides: array of { key, piece, fromX, fromY, toX, toY }
  // (castling produces two slides simultaneously)
  const [animSlides, setAnimSlides] = useState([]);

  // Track which squares are hidden because their piece is mid-animation
  // Set<"row-col">
  const [hiddenSquares, setHiddenSquares] = useState(new Set());

  const myPlayer = color === 'white' ? 1 : 2;
  const isMyTurn = !disabled && (
    (moves.length % 2 === 0 && color === 'white') ||
    (moves.length % 2 === 1 && color === 'black')
  );

  // Convert logical row/col → pixel top-left within the board
  const toPixel = (row, col) => {
    const dr = color === 'black' ? (7 - row) : row;
    const dc = color === 'black' ? (7 - col) : col;
    return { x: dc * SQUARE, y: dr * SQUARE };
  };

  // ── Move animation + board update ─────────────────────────────────────────

  useEffect(() => {
    if (moves.length === 0) {
      setBoard(initBoard());
      setSelected(null);
      setLegalMoves([]);
      setLastMove(null);
      setAnimSlides([]);
      setHiddenSquares(new Set());
      return;
    }

    const mv = moves[moves.length - 1];

    // Rebuild board just before this move so we know what piece is moving
    let prevBoard = initBoard();
    for (let i = 0; i < moves.length - 1; i++) prevBoard = applyMove(prevBoard, moves[i]);

    // Build the list of slides for this move (castling moves 2 pieces)
    const slides = [];
    const hidden = new Set();

    const addSlide = (fromRow, fromCol, toRow, toCol, piece) => {
      const from = toPixel(fromRow, fromCol);
      const to   = toPixel(toRow,   toCol);
      slides.push({ key: `${moves.length}-${fromRow}-${fromCol}`, piece, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      hidden.add(`${fromRow}-${fromCol}`);
    };

    const movingPiece = prevBoard[mv.fromRow][mv.fromCol];
    addSlide(mv.fromRow, mv.fromCol, mv.toRow, mv.toCol, movingPiece);

    if (mv.type === MT.CastleKingSide) {
      const rookRow = mv.fromRow;
      addSlide(rookRow, 7, rookRow, 5, { p: movingPiece.p, t: PT.Rook });
    } else if (mv.type === MT.CastleQueenSide) {
      const rookRow = mv.fromRow;
      addSlide(rookRow, 0, rookRow, 3, { p: movingPiece.p, t: PT.Rook });
    }

    // Show pre-move board with moving pieces hidden; overlay handles them
    setBoard(prevBoard);
    setAnimSlides(slides);
    setHiddenSquares(hidden);
    setSelected(null);
    setLegalMoves([]);

    const t = setTimeout(() => {
      setBoard(applyMove(prevBoard, mv));
      setLastMove(mv);
      setAnimSlides([]);
      setHiddenSquares(new Set());
    }, ANIM_MS + 20);

    return () => clearTimeout(t);
  }, [moves]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legal moves fetch ─────────────────────────────────────────────────────

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

  // ── Click handler ─────────────────────────────────────────────────────────

  const handleSquareClick = (row, col) => {
    if (disabled || promoOpts || animSlides.length > 0) return;
    const piece = board[row][col];

    if (selected) {
      const candidates = legalMoves.filter(m => m.toRow === row && m.toCol === col);

      if (candidates.length > 0) {
        if (candidates[0].type === MT.PawnPromote) {
          setPromoOpts(candidates);
        } else {
          onMove(candidates[0]);
        }
        setSelected(null);
        setLegalMoves([]);
        return;
      }

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

  // ── Board orientation ─────────────────────────────────────────────────────

  const rows  = color === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const cols  = color === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const files = 'abcdefgh';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', display: 'inline-block', userSelect: 'none' }}>

      {/* Board grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(8, ${SQUARE}px)`,
        gridTemplateRows:    `repeat(8, ${SQUARE}px)`,
        border: `${BORDER}px solid #1a1a1a`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        position: 'relative',
      }}>
        {rows.map((row, ri) =>
          cols.map((col, ci) => {
            const light      = (row + col) % 2 === 0;
            const isSel      = selected?.row === row && selected?.col === col;
            const isLegal    = legalMoves.some(m => m.toRow === row && m.toCol === col);
            const isLastFrom = lastMove?.fromRow === row && lastMove?.fromCol === col;
            const isLastTo   = lastMove?.toRow   === row && lastMove?.toCol   === col;
            const piece      = board[row][col];
            const isCapture  = isLegal && piece !== null;
            const isHidden   = hiddenSquares.has(`${row}-${col}`);

            let bg = light ? '#f0d9b5' : '#b58863';
            if (isSel)                       bg = light ? '#7fc97f' : '#4e9e4e';
            else if (isLastFrom || isLastTo) bg = light ? '#cdd26a' : '#aaa23a';

            return (
              <div
                key={`${row}-${col}`}
                onClick={() => handleSquareClick(row, col)}
                style={{
                  width: SQUARE, height: SQUARE, background: bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  cursor: (isMyTurn && !disabled) ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
              >
                {ci === 0 && (
                  <span style={{
                    position: 'absolute', top: 2, left: 3,
                    fontSize: 11, fontWeight: 700, lineHeight: 1,
                    color: light ? '#b58863' : '#f0d9b5',
                    pointerEvents: 'none',
                  }}>{8 - row}</span>
                )}

                {ri === 7 && (
                  <span style={{
                    position: 'absolute', bottom: 2, right: 3,
                    fontSize: 11, fontWeight: 700, lineHeight: 1,
                    color: light ? '#b58863' : '#f0d9b5',
                    pointerEvents: 'none',
                  }}>{files[col]}</span>
                )}

                {isLegal && !piece && (
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.2)',
                    pointerEvents: 'none',
                  }} />
                )}

                {isCapture && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    boxShadow: 'inset 0 0 0 5px rgba(0,0,0,0.25)',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }} />
                )}

                {/* Hide piece while its animated overlay is in flight */}
                {piece && !isHidden && (
                  <img
                    src={pieceImg(piece.p, piece.t)}
                    style={{ width: 52, height: 52, zIndex: 2, pointerEvents: 'none' }}
                    draggable={false}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sliding piece overlays (one per piece in motion) */}
      {animSlides.map(s => (
        <AnimPiece
          key={s.key}
          piece={s.piece}
          fromX={s.fromX} fromY={s.fromY}
          toX={s.toX}     toY={s.toY}
        />
      ))}

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
                  width: 64, height: 64,
                  background: '#f0d9b5', border: '2px solid #b58863',
                  borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <img src={pieceImg(myPlayer, pt)} style={{ width: 52, height: 52 }} draggable={false} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
