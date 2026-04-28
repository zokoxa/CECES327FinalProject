# CECS 327 Final Project — System Architecture

## Overview

This project is a real-time multiplayer chess application built on a **horizontally scaled client-server architecture** — specifically an **active-active server cluster**. Two identical backend nodes share state through Redis and serve clients simultaneously.

The word "peer" in the codebase refers to the two *server nodes* being peers of each other (equal rank, no master/slave).

---

## Architecture Diagram

```
Browser A                        Browser B
    │                                │
    │ WebSocket                       │ WebSocket
    ▼                                ▼
┌──────────────┐   HTTP move   ┌──────────────┐
│   server     │◄─────────────►│   server2    │
│   peer-1     │   forwarding  │   peer-2     │
│  :3001       │               │  :3002       │
└──────────────┘               └──────────────┘
        │                             │
        └──────────────┬──────────────┘
                       ▼
                  ┌─────────┐
                  │  Redis  │
                  └─────────┘
                  shared game state
                  pub/sub broadcast
                  matchmaking queue
                  distributed locks
                       │
                       ▼
                 ┌──────────┐
                 │ Supabase │
                 └──────────┘
                 persistent storage
                 (games, moves, users)

                  ┌───────────────┐
                  │ chess-engine  │
                  │   (Python)    │
                  └───────────────┘
                  move validation
                  checkmate/draw detection
```

---

## Components

### Client (React + Vite)
- Connects to one of the server nodes via WebSocket (Socket.io)
- Sends moves, receives game state updates
- Has no knowledge of which server node it is connected to

### Server Nodes (Node.js + Express + Socket.io)
- Two identical instances (`peer-1`, `peer-2`) run simultaneously
- Either node can accept any player connection
- Each game has one **owner node** — the node that created the game is authoritative for that game's state
- If a move arrives at the non-owner node, it is forwarded to the owner via HTTP (`POST /internal/move`)
- If the owner node goes down, the surviving node can take over via the failover logic (`tryTakeOwnership`)

### Redis
Serves three distinct roles:

| Role | Mechanism |
|---|---|
| Shared game state | `game:{id}` keys store live game objects |
| Cross-node broadcast | Socket.io Redis adapter — `io.to(room).emit()` reaches clients on any node |
| Matchmaking queue | `LPOP`/`RPUSH` via atomic Lua script |
| Distributed locking | Per-game mutex + idempotency keys prevent double-moves |

### Chess Engine (Python / Flask)
- Stateless HTTP service
- Validates moves against the current game history
- Detects checkmate, stalemate, and draw conditions
- Called by the owner node on every move

### Supabase (PostgreSQL)
- Persistent record of all games and moves
- Used for game history, replay, and reporting
- Not in the hot path for move processing

---

## Game Ownership Model

When two players are matched, the node that ran `_createGame` becomes the **owner** of that game. This is stored directly on the game object in Redis:

```json
{
  "ownerNodeId": "peer-1",
  "ownerAddress": "http://server:3001"
}
```

**Move flow on the owner node:**
1. Acquire per-game distributed lock
2. Re-fetch game state inside the lock
3. Check idempotency key (reject duplicate moves from retries)
4. Validate turn order
5. Send move to chess engine for validation
6. Persist move to Redis and Supabase
7. Broadcast result to all nodes via Redis adapter
8. Release lock

**Move flow on a non-owner node:**
1. Detect that `ownerNodeId !== this.nodeId`
2. Forward move via `POST /internal/move` to the owner's address
3. If owner is unreachable, attempt to claim ownership (`tryTakeOwnership`) and process locally

---

## Concurrency Protections

Two layers prevent race conditions and duplicate moves:

**Layer 1 — Distributed mutex**
A Redis lock (`lock:game:{id}`) is acquired before any write. Only one node can process a move for a given game at a time. The lock is released via a Lua compare-and-delete script so a slow process can't accidentally release a lock it no longer owns.

**Layer 2 — Idempotency key**
A short-lived key (`action:{gameId}:{moveNumber}`) is written atomically inside the lock. If a client retries the same move after a disconnect, the key still exists and the move is rejected cleanly.

---

## Disconnect & Reconnect

When a player disconnects mid-game:
- The game is moved to `paused` status (not immediately ended)
- A 2-minute grace window is set (`disconnectGraceUntil`)
- The opponent is notified via `game:paused`
- If the player reconnects within the window, the game resumes
- If the grace window expires, `expirePausedGames` (runs every 5s) ends the game and awards the win to the connected player

---

## What This Architecture Is NOT

| Term | Why it doesn't apply |
|---|---|
| **Master/slave** | Both server nodes are equal. There is no dedicated master. |
| **Serverless** | Requires persistent WebSocket connections and in-memory state. |
| **Microservices** | The two server nodes run identical code, not separate bounded contexts. |

The correct term is **active-active clustering** — both nodes handle live traffic simultaneously, sharing state through a central store.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Socket.io client |
| Backend | Node.js, Express, Socket.io |
| Realtime transport | WebSocket (Socket.io) |
| Shared state / locking | Redis (ioredis) |
| Cross-node broadcast | Socket.io Redis adapter |
| Persistent storage | Supabase (PostgreSQL) |
| Move validation | Python chess engine (Flask) |
| Containerisation | Docker, Docker Compose |
