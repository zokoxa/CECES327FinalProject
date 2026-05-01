import Redis from 'ioredis';

function sentinelConfig() {
  const hosts = process.env.REDIS_SENTINEL_HOSTS;
  if (!hosts) return null;
  return {
    sentinels: hosts.split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port) || 26379 };
    }),
    name: 'mymaster',
  };
}

export function createRedisClient() {
  const sentinel = sentinelConfig();
  const client = sentinel
    ? new Redis(sentinel)
    : new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  client.on('error', (err) => console.error('Redis client error:', err.message));
  return client;
}

export const redis = createRedisClient();
