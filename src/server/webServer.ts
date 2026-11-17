import Fastify from 'fastify';
import { getEnv } from '../config/env.js';
import { STORAGE_CHANNEL_NAME } from '../storage/discordStorage.js';

export interface WebServerOptions {
  isBotConnected: () => boolean;
}

export async function createWebServer(options: WebServerOptions) {
  const env = getEnv();
  const app = Fastify({
    logger: env.NODE_ENV === 'production' ? { level: 'info' } : false,
    trustProxy: true,
  });

  app.get('/health', async (_req, reply) => {
    const botConnected = options.isBotConnected();
    return reply.status(200).send({
      ok: true,
      service: 'bloxberry-labs-pm',
      storage: {
        type: 'discord-channel',
        channelName: STORAGE_CHANNEL_NAME,
        status: 'active',
      },
      botConnected,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/', async () => ({
    service: 'Bloxberry Labs Project & Task Management Bot',
    status: 'online',
    storage: 'discord-channel',
    health: '/health',
  }));

  return app;
}
