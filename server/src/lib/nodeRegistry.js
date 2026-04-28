const REGISTRY_KEY      = 'nodes:registry';
const LOAD_KEY          = 'nodes:load';   // sorted set: nodeId → active game count
const HEARTBEAT_INTERVAL = 15_000;   // 15 s
const STALE_THRESHOLD    = 45_000;   // 3 missed heartbeats → stale

/**
 * NodeRegistry
 *
 * Each server node registers itself in a shared Redis hash on startup and
 * keeps a heartbeat alive. Any node can look up the HTTP address of any
 * other live node so it can forward game actions to the correct owner.
 */
export class NodeRegistry {
  constructor(redis, nodeId, nodeAddress) {
    this.redis       = redis;
    this.nodeId      = nodeId;
    this.nodeAddress = nodeAddress;
  }

  /** Write this node into the registry (called on startup). */
  async register() {
    await this._write();
    // NX = only set if not already present, so a restart doesn't reset a live count
    await this.redis.zadd(LOAD_KEY, 'NX', 0, this.nodeId);
    console.log(`🌐 Node [${this.nodeId}] registered — ${this.nodeAddress}`);
  }

  /** Periodically refresh lastSeen so other nodes know this node is alive. */
  startHeartbeat() {
    setInterval(() => this._write(), HEARTBEAT_INTERVAL);
  }

  /** Remove this node from the registry (called on graceful shutdown). */
  async deregister() {
    await this.redis.hdel(REGISTRY_KEY, this.nodeId);
    await this.redis.zrem(LOAD_KEY, this.nodeId);
    console.log(`🔌 Node [${this.nodeId}] deregistered`);
  }

  /** Return the HTTP address of a specific node, or null if unknown/stale. */
  async getAddress(nodeId) {
    const raw = await this.redis.hget(REGISTRY_KEY, nodeId);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (Date.now() - info.lastSeen > STALE_THRESHOLD) return null;
    return info.address;
  }

  /** Return all currently active nodes (excluding stale entries). */
  async getAll() {
    const all = (await this.redis.hgetall(REGISTRY_KEY)) ?? {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(all)
        .map(([id, json]) => [id, JSON.parse(json)])
        .filter(([, info]) => now - info.lastSeen < STALE_THRESHOLD)
    );
  }

  /**
   * Return the live node with the fewest active games.
   * Falls back to this node if no data is available.
   */
  async getLeastLoadedNode() {
    const liveNodes = await this.getAll();
    if (Object.keys(liveNodes).length === 0) {
      return { nodeId: this.nodeId, address: this.nodeAddress };
    }

    // zrange returns [nodeId, score, nodeId, score, ...] sorted ascending by score
    const ranked = await this.redis.zrange(LOAD_KEY, 0, -1, 'WITHSCORES');

    for (let i = 0; i < ranked.length; i += 2) {
      const nodeId = ranked[i];
      if (liveNodes[nodeId]) {
        return { nodeId, address: liveNodes[nodeId].address };
      }
    }

    return { nodeId: this.nodeId, address: this.nodeAddress };
  }

  async incrementLoad(nodeId) {
    await this.redis.zincrby(LOAD_KEY, 1, nodeId);
  }

  async decrementLoad(nodeId) {
    await this.redis.zincrby(LOAD_KEY, -1, nodeId);
  }

  async _write() {
    await this.redis.hset(REGISTRY_KEY, this.nodeId, JSON.stringify({
      address:  this.nodeAddress,
      lastSeen: Date.now(),
    }));
  }
}
