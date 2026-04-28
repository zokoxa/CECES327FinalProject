# Contribution Statement
### CECS 327 Final Project — Chessmate
### Team Leader: Hector Soltero

---

## Team Members and Contributions

| Name | Primary Area | Key Responsibilities |
|---|---|---|
| Hector | Misc. Features | Invite through username; Play vs Stockfish at multiple difficulty levels |
| Loc Le | Distributed Architecture | Convert centralized design to distributed node-style architecture |
| Jennifer Bui | Event History | Game replay; event history with ordered moves; game recovery after disconnect |
| Reymes Olide | Event History | Game replay; reconnect/recover game state; node failure recovery |
| Arturo Flores | Concurrency Control | Atomic matchmaking — safe queue removal and match creation |
| Adiyan Hossain | Concurrency Control | Owner node enforcement; move version numbers; duplicate action rejection; atomic matchmaking |

---

## Detailed Contribution Descriptions

### Hector
**Area 5 — Misc. Features**
- Implemented invite-by-username: Socket.IO invite/accept/decline/cancel flow, real-time pop-up notification for incoming invites
- Integrated Stockfish WASM engine for Play vs Computer mode with 8 selectable difficulty levels (Beginner → Master), including skill-level mapping and per-level think time
- Authored `docker-compose.yml` and managed end-to-end containerized deployment
- Fixed logout button and coordinated final integration across all components

### Loc Le
**Area 1 — Distributed Node-Style Architecture**
- Led the conversion from a centralized single-server design to a distributed active-active cluster
- Designed the owner-node model: each game is assigned one authoritative node responsible for processing moves; non-owner nodes forward moves via HTTP to the owner
- Established that different nodes handle different games (no single bottleneck), enabling horizontal scaling
- Authored `architecture.md` documenting the cluster design, ownership model, and system components
- Contributed to `Report.md` abstract, introduction, and methodology sections

### Jennifer Bui
**Area 2 — Event History (Data Consistency)**
- Implemented ordered move recording: each move is persisted to Supabase with sequence number, enabling full game reconstruction from history
- Built the game replay feature: users can step through any completed game move by move from the lobby's Recent Games sidebar
- Contributed to game recovery: the event history backing allows game state to be rebuilt after a disconnect or node failure

### Reymes Olide
**Area 2 — Event History (Fault Tolerance)**
- Implemented game reconnect/recovery: when a user disconnects mid-game, the system enters a paused state with a 2-minute grace window; on reconnect the full game state is restored from event history
- Ensured game state is not lost on node failure because all accepted moves are durably recorded in Supabase before the result is broadcast
- Handled which node the user reconnects to and how the recovering node retrieves the game state

### Arturo Flores
**Area 3 — Concurrency Control (Atomic Matchmaking)**
- Made matchmaking atomic using a Redis Lua script: queue removal and match creation execute as a single indivisible operation
- Prevents the race condition where two nodes simultaneously pull the same waiting player, or one player is matched twice
- Ensured the matchmaking queue is safe under concurrent access across multiple server nodes

### Adiyan Hossain
**Area 3 — Concurrency Control (Owner Node & Move Versioning)**
- Enforced single-owner processing: each game has exactly one active owner node; only that node may commit state changes, preventing two servers from updating the same game simultaneously
- Implemented move version numbers (idempotency keys): each accepted move is tied to the expected next move number; late-arriving or retried moves referencing a stale version are rejected
- Implemented duplicate action rejection: if a disconnect or timeout causes a move to be retried, the idempotency key ensures it cannot be applied twice
- Also contributed to atomic matchmaking alongside Arturo Flores

---

## Notes

- Load balancing (Area 4 from the project breakdown) is implemented: each new game is assigned to the least-loaded node via `getLeastLoadedNode()`, and each node tracks its active game count via `incrementLoad()`.
- Confirm all full legal names match your official course enrollment before submitting.
