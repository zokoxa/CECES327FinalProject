import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

async function fetchUsername(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();
  return data?.username ?? null;
}

export const useAuthStore = create((set) => ({
  user: null,
  session: null,
  username: null,
  loading: true,

  init: () => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const username = session ? await fetchUsername(session.user.id) : null;
      set({ session, user: session?.user ?? null, username, loading: false });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const username = session ? await fetchUsername(session.user.id) : null;
        set({ session, user: session?.user ?? null, username, loading: false });
      }
    );

    return () => subscription.unsubscribe();
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const username = await fetchUsername(data.user.id);
    set({ session: data.session, user: data.user, username });
    return data;
  },

  signOut: () => {
    set({ session: null, user: null, username: null });
    supabase.auth.signOut().catch(() => {});
  },
}));
