import Redis, { RedisOptions } from 'ioredis';

const getRedisConfig = (): RedisOptions => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return {
      maxRetriesPerRequest: null, // Required by BullMQ
    } as RedisOptions;
  }
  
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  };
};

export const redisConnectionOptions = getRedisConfig();

export const redisConnection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new Redis(redisConnectionOptions);

redisConnection.on('error', (err) => {
  console.error('[Redis] Connection error:', err);
});
