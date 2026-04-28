import { useEffect, useMemo, useState } from 'react';

export function useReplay(moves, initialIndex = moves.length) {
  const [replayIndex, setReplayIndex] = useState(initialIndex);

  useEffect(() => {
    setReplayIndex((prev) => {
      if (prev === moves.length - 1) return moves.length;
      return Math.min(prev, moves.length);
    });
  }, [moves.length]);

  const replayMoves = useMemo(() => moves.slice(0, replayIndex), [moves, replayIndex]);
  const isReplayMode = replayIndex !== moves.length;

  const jumpStart = () => setReplayIndex(0);
  const stepBack = () => setReplayIndex((prev) => Math.max(0, prev - 1));
  const stepForward = () => setReplayIndex((prev) => Math.min(moves.length, prev + 1));
  const jumpEnd = () => setReplayIndex(moves.length);
  const jumpToMove = (index) => setReplayIndex(Math.max(0, Math.min(index, moves.length)));

  return {
    replayIndex,
    replayMoves,
    isReplayMode,
    jumpStart,
    stepBack,
    stepForward,
    jumpEnd,
    jumpToMove,
  };
}
