import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';

const UCI_PROMOTION_TO_PIECE = {
  p: 1,
  r: 2,
  n: 3,
  b: 4,
  q: 5,
  k: 6,
};

function parseUciMove(moveNotation) {
  const m = String(moveNotation || '').trim().toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([prnbqk]?)$/);
  if (!m) return null;

  const [, from, to, promo] = m;
  const fromCol = from.charCodeAt(0) - 'a'.charCodeAt(0);
  const fromRow = 8 - Number(from[1]);
  const toCol = to.charCodeAt(0) - 'a'.charCodeAt(0);
  const toRow = 8 - Number(to[1]);

  return {
    fromRow,
    fromCol,
    toRow,
    toCol,
    promotion: promo ? UCI_PROMOTION_TO_PIECE[promo] : undefined,
  };
}

async function fetchLegalMoves(history) {
  const res = await fetch(`${CHESS_ENGINE_URL}/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history }),
  });

  if (!res.ok) {
    throw new Error('Chess engine unavailable while reconstructing replay');
  }

  const body = await res.json();
  return body?.moves || [];
}

async function reconstructMovesFromNotation(orderedMoveNotations) {
  const history = [];

  for (const moveNotation of orderedMoveNotations) {
    const parsed = parseUciMove(moveNotation);
    if (!parsed) {
      throw new Error(`Cannot parse stored move notation: ${moveNotation}`);
    }

    const legalMoves = await fetchLegalMoves(history);
    const matched = legalMoves.find((mv) => (
      mv.fromRow === parsed.fromRow &&
      mv.fromCol === parsed.fromCol &&
      mv.toRow === parsed.toRow &&
      mv.toCol === parsed.toCol &&
      (mv.promotion || undefined) === parsed.promotion
    ));

    if (!matched) {
      throw new Error(`Stored move is not legal in reconstructed position: ${moveNotation}`);
    }

    history.push(matched);
  }

  return history;
}

router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 30));

  const { data: games, error } = await supabase
    .from('games')
    .select('id, white_id, black_id, status, result, reason, started_at, ended_at')
    .or(`white_id.eq.${req.user.id},black_id.eq.${req.user.id}`)
    .eq('status', 'finished')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: 'Failed to load game history' });
  }

  const allProfileIds = [...new Set((games || []).flatMap((g) => [g.white_id, g.black_id]).filter(Boolean))];

  let profileMap = {};
  if (allProfileIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', allProfileIds);

    profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }

  const payload = (games || []).map((g) => {
    const isWhite = g.white_id === req.user.id;
    return {
      ...g,
      color: isWhite ? 'white' : 'black',
      white: profileMap[g.white_id] || { id: g.white_id, username: 'White' },
      black: profileMap[g.black_id] || { id: g.black_id, username: 'Black' },
    };
  });

  res.json({ games: payload });
});

router.get('/history/:gameId/replay', requireAuth, async (req, res) => {
  const { gameId } = req.params;

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, white_id, black_id, status, result, reason, started_at, ended_at')
    .eq('id', gameId)
    .single();

  if (gameError || !game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.white_id !== req.user.id && game.black_id !== req.user.id) {
    return res.status(403).json({ error: 'Not allowed to access this game' });
  }

  const { data: movesRows, error: movesError } = await supabase
    .from('moves')
    .select('move_number, move_notation')
    .eq('game_id', gameId)
    .order('move_number', { ascending: true });

  if (movesError) {
    return res.status(500).json({ error: 'Failed to load game moves' });
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', [game.white_id, game.black_id]);

  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  let reconstructedMoves;
  try {
    reconstructedMoves = await reconstructMovesFromNotation((movesRows || []).map((m) => m.move_notation));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to reconstruct move history' });
  }

  const isWhite = game.white_id === req.user.id;

  res.json({
    game: {
      ...game,
      color: isWhite ? 'white' : 'black',
      white: profileMap[game.white_id] || { id: game.white_id, username: 'White' },
      black: profileMap[game.black_id] || { id: game.black_id, username: 'Black' },
    },
    moves: reconstructedMoves,
  });
});

export default router;
