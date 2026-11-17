import { REST, Routes } from 'discord.js';
import { getEnv } from '../config/env.js';
import { getCommandJsonPayloads } from './commands/index.js';

export async function registerSlashCommands(params: {
  token: string;
  clientId?: string;
  guildId?: string;
}): Promise<number> {
  const rest = new REST({ version: '10', retries: 3 }).setToken(params.token);
  const body = getCommandJsonPayloads();

  let clientId = params.clientId;
  if (!clientId) {
    const user = (await rest.get(Routes.user('@me'))) as { id: string };
    clientId = user.id;
  }

  if (params.guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, params.guildId), { body });
    console.log(`[Bot] Registered ${body.length} guild slash commands for guild ${params.guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`[Bot] Registered ${body.length} global slash commands.`);
  }

  return body.length;
}

// Allow running directly via `npm run deploy:commands`
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('deployCommands.ts') || process.argv[1].endsWith('deployCommands.js'));

if (isDirectRun) {
  const env = getEnv();
  if (!env.DISCORD_TOKEN) {
    console.error('[Bot] DISCORD_TOKEN is required to deploy commands.');
    process.exit(1);
  }
  registerSlashCommands({
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID || undefined,
    guildId: env.DISCORD_GUILD_ID || undefined,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Bot] Command deployment failed:', err);
      process.exit(1);
    });
}
