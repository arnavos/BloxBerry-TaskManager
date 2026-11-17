import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((val) => val === 'true' || val === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),

  // Only DISCORD_TOKEN is required in production
  DISCORD_TOKEN: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  DEPLOY_COMMANDS_ON_BOOT: booleanString.default('true'),

  DEADLINE_CHECK_INTERVAL_MS: z.coerce.number().int().min(5000).default(30_000),
  MANAGEMENT_OVERDUE_REMINDER_DELAY_MINUTES: z.coerce.number().int().min(1).default(120),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTesting(): void {
  cachedEnv = null;
}
