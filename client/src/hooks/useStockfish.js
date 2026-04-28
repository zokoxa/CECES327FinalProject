import { useEffect, useRef, useCallback } from 'react';

const FILES = 'abcdefgh';

function toUci({ fromRow, fromCol, toRow, toCol, promotion }) {
  const from = `${FILES[fromCol]}${8 - fromRow}`;
  const to   = `${FILES[toCol]}${8 - toRow}`;
  const promo = promotion ? ['', 'p', 'r', 'n', 'b', 'q', 'k'][promotion] : '';
  return `${from}${to}${promo}`;
}

export function fromUci(uci) {
  const promoMap = { q: 5, r: 2, b: 4, n: 3 };
  return {
    fromRow:   8 - parseInt(uci[1]),
    fromCol:   FILES.indexOf(uci[0]),
    toRow:     8 - parseInt(uci[3]),
    toCol:     FILES.indexOf(uci[2]),
    promotion: uci[4] ? promoMap[uci[4]] : undefined,
  };
}

// Map user-facing level (1–8) to Stockfish Skill Level (0–20)
function toSkillLevel(level) {
  return Math.round(((level - 1) / 7) * 20);
}

// Stronger levels get more think time
const MOVETIMES = [50, 100, 200, 300, 500, 800, 1200, 2000];

export function useStockfish() {
  const workerRef  = useRef(null);
  const resolveRef = useRef(null);

  useEffect(() => {
    const worker = new Worker('/stockfish.js');
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const line = typeof e === 'string' ? e : e.data;
      if (typeof line === 'string' && line.startsWith('bestmove')) {
        const uciMove = line.split(' ')[1];
        if (resolveRef.current && uciMove && uciMove !== '(none)') {
          resolveRef.current(uciMove);
          resolveRef.current = null;
        } else if (resolveRef.current) {
          resolveRef.current(null);
          resolveRef.current = null;
        }
      }
    };

    worker.postMessage('uci');
    worker.postMessage('isready');

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const getBestMove = useCallback((moves, skillLevel) => {
    return new Promise((resolve) => {
      const worker = workerRef.current;
      if (!worker) { resolve(null); return; }

      resolveRef.current = resolve;

      const sl       = toSkillLevel(skillLevel);
      const movetime = MOVETIMES[skillLevel - 1] ?? 500;
      const uciMoves = moves.map(toUci).join(' ');
      const position = uciMoves
        ? `position startpos moves ${uciMoves}`
        : 'position startpos';

      worker.postMessage(`setoption name Skill Level value ${sl}`);
      worker.postMessage(position);
      worker.postMessage(`go movetime ${movetime}`);
    });
  }, []);

  return { getBestMove };
}
