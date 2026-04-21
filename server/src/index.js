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
import { PeerRegistry } from './lib/peerRegistry.js';

// ─── Peer Identity ──────────────────────────────────────────────────────────
// Each node must be given a unique NODE_ID and its own reachable NODE_ADDRESS
// (the HTTP URL other peers will use to forward moves to this node).
const PORT         = process.env.PORT         || 3001;
const NODE_ID      = process.env.NODE_ID      || 'peer-1';
const NODE_ADDRESS = process.env.NODE_ADDRESS || `http://localhost:${PORT}`;

const app        = express();
const httpServer = createServer(app);

// ─── Socket.io with Redis adapter ───────────────────────────────────────────
// The Redis pub/sub adapter lets io.to(room).emit() reach clients connected
// to ANY peer node — the backbone of cross-node broadcasting.
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subClient = pubClient.duplicate();

pubClient.on('connect', () => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Socket.io connected to Redis adapter');
});
pubClient.on('error', (err) => {
  console.warn('⚠️  Redis unavailable — running without distributed adapter:', err.message);
});

// ─── Peer Registry ──────────────────────────────────────────────────────────
const peerRegistry = new PeerRegistry(pubClient, NODE_ID, NODE_ADDRESS);

// Register this node and start the heartbeat after Redis connects
pubClient.once('connect', async () => {
  await peerRegistry.register();
  peerRegistry.startHeartbeat();
});

// Graceful shutdown — remove from registry so peers stop routing to this node
process.on('SIGTERM', async () => {
  await peerRegistry.deregister();
  process.exit(0);
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ─── REST Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', nodeId: NODE_ID, nodeAddress: NODE_ADDRESS })
);

// List all live peer nodes — useful for debugging / demo
app.get('/api/peers', async (_req, res) => {
  const peers = await peerRegistry.getAll();
  res.json({ nodeId: NODE_ID, peers });
});

const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';

// Proxy to chess engine — returns all legal moves for a given position
app.post('/api/game/moves', async (req, res) => {
  try {
    const upstream = await fetch(`${CHESS_ENGINE_URL}/moves`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });
    res.json(await upstream.json());
  } catch {
    res.status(503).json({ error: 'Chess engine unavailable' });
  }
});

// ─── Internal Peer Endpoint ──────────────────────────────────────────────────
// Non-owner nodes POST here to forward a player's move to the owner node.
// Only reachable within the Docker network (no JWT check needed).
app.post('/internal/move', async (req, res) => {
  const { gameId, move, userId } = req.body;
  if (!gameId || !move || !userId) {
    return res.status(400).json({ error: 'Missing gameId, move, or userId' });
  }

  // gameManager is set after socket handlers are registered (below)
  const err = await app.locals.gameManager?.processForwardedMove({ gameId, move, userId });
  if (err) return res.status(400).json({ error: err });
  res.json({ ok: true });
});

// ─── Socket.io Auth Guard ────────────────────────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  const user = await verifyToken(token);
  if (!user) return next(new Error('Invalid token'));

  socket.user = user;
  next();
});

// ─── Socket Handlers ─────────────────────────────────────────────────────────
// Pass nodeId and nodeAddress so GameManager can stamp ownership and forward
const gameManager = registerSocketHandlers(io, NODE_ID, NODE_ADDRESS);
app.locals.gameManager = gameManager;

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🚀 Server [${NODE_ID}] running on port ${PORT}`);
});
