import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisClient } from './lib/redis.js';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import friendsRoutes from './routes/friends.js';
import { registerSocketHandlers } from './socket/index.js';
import { verifyToken } from './middleware/auth.js';
import { NodeRegistry } from './lib/nodeRegistry.js';

// ─── Node Identity ───────────────────────────────────────────────────────────
// Each node must be given a unique NODE_ID and its own reachable NODE_ADDRESS
// (the HTTP URL other nodes will use to route moves to this node).
const PORT         = process.env.PORT         || 3001;
const NODE_ID      = process.env.NODE_ID      || 'node-1';
const HOST         = process.env.HOST         || '::';
const NODE_ADDRESS = process.env.NODE_ADDRESS ||
  (process.env.RAILWAY_PRIVATE_DOMAIN
    ? `http://${process.env.RAILWAY_PRIVATE_DOMAIN}:${PORT}`
    : `http://localhost:${PORT}`);

const app        = express();
const httpServer = createServer(app);

// ─── Socket.io with Redis adapter ───────────────────────────────────────────
// The Redis pub/sub adapter lets io.to(room).emit() reach clients connected
// to any server node — the backbone of cross-node broadcasting.
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});

const pubClient = createRedisClient();
const subClient = createRedisClient();

pubClient.on('connect', () => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Socket.io connected to Redis adapter');
});
pubClient.on('error', (err) => {
  console.warn('⚠️  Redis unavailable — running without distributed adapter:', err.message);
});

// ─── Node Registry ──────────────────────────────────────────────────────────
const nodeRegistry = new NodeRegistry(pubClient, NODE_ID, NODE_ADDRESS);

// Register this node and start the heartbeat after Redis connects
pubClient.once('connect', async () => {
  await nodeRegistry.register();
  nodeRegistry.startHeartbeat();
});

// Graceful shutdown — deregister so other nodes stop forwarding to this one
process.on('SIGTERM', async () => {
  await nodeRegistry.deregister();
  process.exit(0);
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ─── REST Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/friends', friendsRoutes);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', nodeId: NODE_ID, nodeAddress: NODE_ADDRESS })
);

// List all live cluster nodes — useful for debugging / demo
app.get('/api/nodes', async (_req, res) => {
  const nodes = await nodeRegistry.getAll();
  res.json({ nodeId: NODE_ID, nodes });
});

const CHESS_ENGINE_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:5001';

// Proxy to chess engine — validates a single move and returns game-state flags
app.post('/api/game/validate', async (req, res) => {
  try {
    const upstream = await fetch(`${CHESS_ENGINE_URL}/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });
    res.json(await upstream.json());
  } catch {
    res.status(503).json({ error: 'Chess engine unavailable' });
  }
});

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

// ─── Internal Node Endpoint ──────────────────────────────────────────────────
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
  socket.data.user = {
    id: user.id,
    username: user.username,
  };
  next();
});

// ─── Socket Handlers ─────────────────────────────────────────────────────────
// Pass nodeId and nodeAddress so GameManager can stamp ownership and forward
const gameManager = registerSocketHandlers(io, NODE_ID, NODE_ADDRESS, nodeRegistry);
app.locals.gameManager = gameManager;
app.locals.io = io;

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, HOST, () => {
  console.log(`Server [${NODE_ID}] running on ${HOST}:${PORT}`);
});
