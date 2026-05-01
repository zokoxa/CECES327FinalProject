import Redis from 'ioredis';

function sentinelConfig() {
  const hosts = process.env.REDIS_SENTINEL_HOSTS;
  if (!hosts) return null;
  const config = {
    sentinels: hosts.split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port) || 26379 };
    }),
    name: 'mymaster',
  };
  if (process.env.REDIS_PASSWORD) config.password = process.env.REDIS_PASSWORD;
  return config;
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
