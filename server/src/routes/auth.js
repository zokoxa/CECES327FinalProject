import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/register
 * Creates a Supabase auth user + a profile row.
 */
router.post('/register', async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, password, and username are required' });
  }

  // Check username uniqueness
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single();

  if (existing) return res.status(409).json({ error: 'Username already taken' });

  // Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) return res.status(400).json({ error: authError.message });

  // Create profile row
  await supabase.from('profiles').insert({
    id: authData.user.id,
    username,
    rating: 1200, // starting Elo
  });

  res.status(201).json({ message: 'Account created. You can now log in.' });
});

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile.
 */
router.get('/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  res.json({ user: { ...req.user, ...profile } });
});

export default router;
