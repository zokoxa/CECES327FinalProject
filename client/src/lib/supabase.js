import { createClient } from '@supabase/supabase-js';

// Use the anon key on the client (respects RLS policies)
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
