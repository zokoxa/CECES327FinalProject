import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import { registerSocketHandlers } from './socket/index.js';
import { verifyToken } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);

// ─── Socket.io with Redis adapter for horizontal scaling ───────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Connect Redis for distributed pub/sub between server instances
const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subClient = pubClient.duplicate();

pubClient.on('connect', () => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Socket.io connected to Redis adapter');
});
pubClient.on('error', (err) => {
  console.warn('⚠️  Redis unavailable — running without distributed adapter:', err.message);
});

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ─── REST Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ─── Socket.io Auth Guard ───────────────────────────────────────────────────
// Validate JWT before allowing socket connection
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  const user = await verifyToken(token);
  if (!user) return next(new Error('Invalid token'));

  socket.user = user; // attach user to socket
  next();
});

// ─── Socket Handlers ────────────────────────────────────────────────────────
registerSocketHandlers(io);

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
