import { getEnv } from './config/env.js';
import { createDiscordBot } from './bot/client.js';
import { DeadlineScheduler } from './services/schedulerService.js';
import { createWebServer } from './server/webServer.js';

async function bootstrap() {
  const env = getEnv();
  console.log(`[Startup] Booting Bloxberry Labs PM Bot (env=${env.NODE_ENV}, tz=${env.DEFAULT_TIMEZONE})`);

  const bot = createDiscordBot();

  const webServer = await createWebServer({
    isBotConnected: bot.isConnected,
  });

  // Bind HTTP server immediately so Render Web Service port check succeeds
  await webServer.listen({ port: env.PORT, host: env.HOST });
  console.log(`[Web] Health endpoint listening on http://${env.HOST}:${env.PORT}/health`);

  const scheduler = new DeadlineScheduler(
    bot.transport,
    env.DEADLINE_CHECK_INTERVAL_MS,
    env.MANAGEMENT_OVERDUE_REMINDER_DELAY_MINUTES
  );
  scheduler.start();

  // Start Discord bot without blocking the HTTP server
  bot.start().catch((err) => {
    console.error('[Bot] Login failed (health endpoint stays online):', err instanceof Error ? err.message : err);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, draining services...`);
    scheduler.stop();
    await Promise.allSettled([
      bot.stop(),
      webServer.close(),
    ]);
    console.log('[Shutdown] Clean exit.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal] Startup failed:', err);
  process.exit(1);
});
