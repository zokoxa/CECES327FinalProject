import { supabase } from '../lib/supabase.js';

/**
 * Verify a Supabase JWT and return the user object, or null if invalid.
 * Used by both the Socket.io auth guard and REST middleware.
 */
export async function verifyToken(token) {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;

    // Fetch the profile row to get the username
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', data.user.id)
      .single();

    return {
      id: data.user.id,
      email: data.user.email,
      username: profile?.username ?? data.user.email,
    };
  } catch {
    return null;
  }
}

/**
 * Express middleware — attaches req.user or returns 401.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  const user = await verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
}
