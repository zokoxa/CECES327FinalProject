import { createClient } from '@supabase/supabase-js';

// Use the anon key on the client (respects RLS policies)
// persistSession: false keeps the session in memory only.
// This means closing the tab logs you out, and multiple tabs
// in the same browser don't overwrite each other's session.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);
