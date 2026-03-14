import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import { useSocketStore } from './store/socketStore.js';
import Home from './pages/Home.jsx';
import Game from './pages/Game.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';

function PrivateRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="loading">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const session = useAuthStore((s) => s.session);
  const { connect, disconnect } = useSocketStore();

  // Keep one socket alive for the entire authenticated session
  useEffect(() => {
    if (session?.access_token) {
      connect(session.access_token);
    } else {
      disconnect();
    }
  }, [session?.access_token]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
      <Route path="/game/:gameId" element={<PrivateRoute><Game /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
