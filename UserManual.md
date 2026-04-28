# Chessmate — User Manual
### CECS 327 Final Project

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Installation & Setup](#2-installation--setup)
3. [Running the Application](#3-running-the-application)
4. [Creating an Account](#4-creating-an-account)
5. [The Lobby](#5-the-lobby)
6. [Play Online (Matchmaking)](#6-play-online-matchmaking)
7. [Invite a Player by Username](#7-invite-a-player-by-username)
8. [Play vs Computer (Stockfish)](#8-play-vs-computer-stockfish)
9. [In-Game Controls](#9-in-game-controls)
10. [Disconnect & Reconnect](#10-disconnect--reconnect)
11. [Game History & Replay](#11-game-history--replay)
12. [Stopping the Application](#12-stopping-the-application)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| **Docker Desktop** | Version 4.x or later — must be running before you start |
| **The `.env` file** | Contains Supabase credentials — request it from the team leader |
| **Port 80** | Must be free on your machine (the client is served on `http://localhost`) |

---

## 2. Installation & Setup

1. Obtain the `.env` file from the team leader and place it in the **project root** (same folder as `docker-compose.yml`).
2. Verify Docker Desktop is running (the whale icon should appear in your system tray / menu bar).
3. Open a terminal in the project root.

The `.env` file must contain the following variables (values provided by the team leader):
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## 3. Running the Application

From the project root, build and start all containers:

```bash
docker compose up --build
```

The first build downloads dependencies and compiles the chess engine — this may take **3–5 minutes**.  
Subsequent starts (without `--build`) are much faster.

**What starts:**

| Container | Role | Internal Port |
|---|---|---|
| `redis` | Shared state, pub/sub, distributed locks | 6379 |
| `chess-engine` | Move validation service (C#/.NET) | 5001 |
| `server` (node-1) | Game coordination peer node 1 | 3001 |
| `server2` (node-2) | Game coordination peer node 2 | 3002 |
| `client` | React frontend (served via Nginx) | **80** |

Once you see both server nodes report healthy, open your browser to:

```
http://localhost
```

---

## 4. Creating an Account

1. Click **Sign Up** on the login screen.
2. Enter a **username**, **email address**, and **password**.
3. Click **Create Account** — you will be signed in automatically.

> Accounts are stored in Supabase. You can log back in from any device using your email and password.

---

## 5. The Lobby

After logging in you land on the lobby screen, which has three sections:

| Section | Description |
|---|---|
| **Play controls** | Start matchmaking, invite a player, or play vs computer |
| **Recent Games sidebar** | Your last 10 completed games with result badges |
| **Logout button** | Top-right corner — signs you out and returns to login |

---

## 6. Play Online (Matchmaking)

1. Click **Play Online** in the lobby.
2. The button changes to "Searching for an opponent…" with a **Cancel** button.
3. When another player also clicks Play Online, the server matches the two of you automatically and the game starts.
4. Colors (White / Black) are assigned randomly.

> Both players can be connected to different server nodes — the distributed architecture handles cross-node coordination transparently.

---

## 7. Invite a Player by Username

You can challenge a specific player instead of waiting in the random matchmaking queue.

1. In the **Invite a Player** panel, type the exact username of the player you want to challenge.
2. Press **Enter** or click **Invite**.
3. The other player receives a pop-up notification: "**[your username]** invited you to play!"
4. They click **Accept** to start the game, or **Decline** to reject.
5. If they decline, you are notified and can invite someone else.
6. To cancel a pending invite, click **Cancel** next to the invite status message.

> Both players must be logged in and on the lobby screen for an invite to be delivered.

---

## 8. Play vs Computer (Stockfish)

Play a local game against the Stockfish chess engine directly in your browser — no server required for the AI moves.

1. In the **Play vs Computer** panel, drag the level slider to choose a difficulty:

   | Level | Name |
   |---|---|
   | 1 | Beginner |
   | 2 | Novice |
   | 3 | Amateur |
   | 4 | Intermediate |
   | 5 | Club |
   | 6 | Advanced |
   | 7 | Expert |
   | 8 | Master |

2. Click **Play vs Computer**.
3. You always play as **White**. Stockfish plays Black and responds automatically after each of your moves.
4. A "thinking…" indicator appears while Stockfish is calculating.
5. When the game ends (checkmate, stalemate, 50-move rule, or resignation) a result modal appears.

---

## 9. In-Game Controls

### Making a Move
- Click a piece to select it — legal destination squares are highlighted.
- Click a highlighted square to move.
- For **pawn promotion**, select the promoted piece from the prompt that appears.

### Game Buttons
| Button | Action |
|---|---|
| **Resign** | Immediately forfeit the game |
| **Offer Draw** | Send a draw proposal to your opponent |
| **Home** | Return to the lobby (only available after the game ends) |

### Draw Offers
- When you click **Offer Draw**, your opponent sees a prompt to accept or decline.
- If accepted, the game ends as a draw.
- If declined, play continues normally.

### Turn Indicators
- A green dot appears next to the active player's name.
- "Your turn" text appears in the footer when it is your move.

---

## 10. Disconnect & Reconnect

If you lose your connection mid-game:
- The game enters a **paused** state — your opponent is notified.
- You have a **2-minute grace window** to reconnect.

To reconnect:
1. Refresh the browser or navigate back to `http://localhost`.
2. Log in with the same account.
3. The lobby automatically detects your paused game and sends you back to it.

If the grace window expires, the game is awarded to the connected player.

---

## 11. Game History & Replay

The **Recent Games** sidebar on the lobby screen shows your last 10 completed games.

Each entry displays:
- A result badge: **W** (win, green) / **L** (loss, red) / **D** (draw, yellow)
- Opponent username
- How the game ended (checkmate, resignation, etc.)

**To replay a game:**
1. Click the **▶** button on any history entry.
2. The board loads in replay mode showing the final position.
3. Use the replay controls to step through the game:

   | Button | Action |
   |---|---|
   | `⏮` | Jump to start |
   | `◀` | Step back one move |
   | `▶` | Step forward one move |
   | `⏭` | Jump to end |
   | Move list | Click any move to jump directly to that position |

---

## 12. Stopping the Application

In the terminal where Docker Compose is running, press `Ctrl + C`.

To also remove the containers:
```bash
docker compose down
```

To remove containers **and** all cached images (full clean rebuild next time):
```bash
docker compose down --rmi all
```

---

## 13. Troubleshooting

**Port 80 is already in use**
> Stop any other web server using port 80 (IIS, Apache, another Docker container) and re-run `docker compose up`.

**".env file not found" or Supabase errors**
> Ensure the `.env` file is in the project root (same directory as `docker-compose.yml`) before running `docker compose up --build`.

**"Searching for an opponent" never resolves**
> You need two separate browser sessions (or two different devices) both logged in and clicking Play Online. The matchmaking queue requires two players.

**Chess engine is unreachable**
> The `chess-engine` container must be healthy before the server nodes start. If it failed to build, run `docker compose up --build chess-engine` to rebuild it.

**Stockfish is not responding in vs-Computer mode**
> The Stockfish WASM engine runs in your browser. Ensure your browser supports Web Workers (all modern browsers do). Try a hard refresh (`Ctrl + Shift + R`).

**Game does not resume after reconnect**
> The 2-minute grace window may have expired. Check the lobby — if no resume prompt appears, the game has already ended.
