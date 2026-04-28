# Design and Implementation of a Distributed Real-Time Chess Platform

## Abstract

This report presents the design and implementation of a distributed real-time chess application developed as a course project to study core distributed systems concepts. Although the user-facing product resembles a Chess.com-style platform, the primary objective is pedagogical: to investigate service decomposition, consistency of shared state, fault tolerance, and inter-node coordination under real-time constraints. The system integrates a React client, Node.js Socket.IO peer servers, Redis-backed coordination, Supabase-based identity and persistence, and a C# chess engine for authoritative rule validation. The final implementation demonstrates a functional multi-node architecture with reconnect support, owner-node failover behavior, and reproducible deployment through Docker Compose.

## Introduction

Building a networked chess platform requires strict correctness guarantees and low interaction latency. In a single-node implementation, this requirement is already non-trivial; in a distributed setting, additional concerns emerge, including coordination between peers, recovery from node unavailability, and synchronization of transient and durable state. This project addresses these concerns through a modular architecture that separates presentation, coordination, validation, and persistence responsibilities.

The resulting system consists of: (1) a browser client for gameplay and matchmaking interactions, (2) multiple Node.js peer servers responsible for real-time communication and game orchestration, (3) a dedicated chess engine service that validates legal moves, and (4) storage services for operational and persistent data. This structure provides a practical environment for evaluating distributed systems principles in an interactive application domain.

## Motivation

The project was motivated by a learning goal rather than by product replication alone. Specifically, the team aimed to apply distributed systems theory in an end-to-end software artifact that exhibits realistic failure modes and state-management challenges.

Chess was selected because it imposes deterministic rules, strict turn ordering, and immediate user feedback expectations. These properties make it an effective case study for:

- consistency and ordering in concurrent environments,
- state ownership and authority boundaries,
- reliability under client and server disconnection events,
- coordination across peer nodes, and
- integration of transient in-memory state with durable storage.

Accordingly, the project serves as a hands-on exercise in distributed architecture design, not only a feature-complete game clone.

## Model (Methedology)

The methodology follows a service-oriented model with explicit authority and data-boundary decisions. The implementation is organized into four layers.

1. Client interaction layer (React + Vite)
The client manages rendering of the board, move interactions, matchmaking requests, reconnect requests, and user-facing game status updates. Real-time communication is handled through authenticated Socket.IO sessions.

2. Distributed coordination layer (Node.js + Socket.IO + Redis adapter)
Multiple peer servers run concurrently. Each game is assigned an owner node responsible for authoritative state transitions. Redis is used both as a pub/sub transport for cross-node Socket.IO room broadcasts and as an operational data store for matchmaking queues, active game records, and reconnect metadata.

3. Rule-validation layer (C# chess engine)
Move legality is validated by a separate chess-engine service exposed through HTTP endpoints. This design externalizes rule computation from the client and prevents acceptance of invalid moves at the coordination layer.

4. Persistence and identity layer (Supabase + Redis)
Supabase stores durable entities (profiles, games, and moves), while Redis stores volatile coordination state (queue membership, socket-game associations, paused-game timers, and peer heartbeats). This separation reduces coupling between real-time orchestration and historical record keeping.

Operational sequence:

- users authenticate and join matchmaking,
- a peer server creates a game and becomes owner,
- clients submit moves via Socket.IO,
- the owner validates moves through the chess engine,
- accepted moves are persisted and broadcast to all participants,
- disconnections trigger a paused state with reconnection grace period,
- owner-node unavailability may trigger ownership failover.

This sequence reflects a practical distributed workflow with explicit handling for authority, synchronization, and recovery.

## Problem

The central problem is to maintain a correct and responsive multiplayer chess session when state and communication are distributed across multiple services and peer servers.

Formally, the system must satisfy the following requirements:

- Safety: illegal moves must not be committed.
- Ordering: turns must remain consistent under asynchronous message delivery.
- Liveness: active games should continue despite temporary disconnects.
- Recoverability: clients should be able to reconnect to recoverable sessions.
- Availability: peer-node unavailability should not permanently block game progress.
- Durability: completed actions should be persisted for post-game retrieval and analysis.

The implementation addresses these requirements through owner-based authority, external move validation, Redis-backed coordination, and persistent game/move storage.

## Results

The project achieved the intended functional and educational outcomes.

From a system perspective, the implementation provides:

- successful containerized deployment via Docker Compose,
- real-time matchmaking and gameplay across multiple peer servers,
- authoritative move validation through the external chess-engine service,
- synchronized cross-node event propagation using Redis adapter integration,
- pause-and-resume game handling for disconnect and reconnect scenarios,
- owner failover logic when the designated authority node is unreachable,
- persistent recording of games and move history in Supabase.

From a learning perspective, the project concretely demonstrated distributed systems concepts, including state partitioning, heartbeat-based peer discovery, authority transfer, and trade-offs between operational simplicity and fault tolerance. While the prototype is not yet production hardened, it successfully functions as a course-level distributed systems artifact with clear evidence of architectural reasoning.

## Conclusion (Future work)

This work demonstrates that a chess application can be used effectively as a distributed systems learning platform. By decomposing responsibilities across independent services and implementing ownership, validation, and recovery mechanisms, the project meets its instructional objective of translating distributed systems theory into practice.

Future work will focus on strengthening evaluation rigor and production-readiness:

- introduce quantitative performance experiments (latency, reconnect success rate, failover recovery time),
- implement formal integration and chaos-style fault-injection tests,
- improve security isolation for internal server-to-server forwarding paths,
- add ranking and rating updates as a consistency case study for transactional workflows,
- support spectator and replay pipelines with complete PGN export,
- migrate to managed cloud infrastructure for horizontal scaling experiments.

Overall, the project provides a strong baseline for continued experimentation in distributed coordination, resilience, and real-time systems design.
