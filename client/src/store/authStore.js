import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

/**
 * Global auth state via Zustand.
 * Listens to Supabase's onAuthStateChange so the store stays in sync
 * with the Supabase session automatically (refresh, logout, etc.).
 */
export const useAuthStore = create((set) => ({
  user: null,
  session: null,
  loading: true,

  init: () => {
    // Restore session on page load
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, user: session?.user ?? null, loading: false });
    });

    // Subscribe to future auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        set({ session, user: session?.user ?? null, loading: false });
      }
    );

    return () => subscription.unsubscribe();
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    set({ session: data.session, user: data.user });
    return data;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
