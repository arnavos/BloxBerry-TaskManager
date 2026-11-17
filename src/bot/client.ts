import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
  type Message,
} from 'discord.js';
import { getEnv } from '../config/env.js';
import type { DmNotificationPayload, NotificationTransport } from '../services/schedulerService.js';
import { syncDiscordUser, syncGuildMetadata, upsertDiscordRole } from '../services/userService.js';
import { commandMap } from './commands/index.js';
import { registerSlashCommands } from './deployCommands.js';
import { DANGER_COLOR, WARNING_COLOR } from './embeds/taskEmbeds.js';
import { discordStorage } from '../storage/discordStorage.js';
import { handlePrefixMessage } from './prefixHandler.js';
import {
  handleButtonInteraction,
  handleModalSubmit,
  handleStringSelectInteraction,
  handleUserSelectInteraction,
} from './interactions/checklistHandlers.js';
import {
  handleY2kButtonInteraction,
  handleY2kModalSubmit,
  handleY2kSelectInteraction,
} from './interactions/y2kHandlers.js';

export class DiscordNotificationTransport implements NotificationTransport {
  constructor(private readonly client: Client) {}

  async sendDm(
    userId: string,
    payload: DmNotificationPayload
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client.isReady()) {
      return { ok: false, error: 'Discord bot client is not ready yet' };
    }

    try {
      const user = await this.client.users.fetch(userId);
      const isEscalation = payload.notificationType === 'overdue_management';
      const isOverdue = payload.notificationType === 'overdue_assignee' || isEscalation;

      const title =
        payload.notificationType === 'due_now'
          ? `⏰ Deadline Reached — Task #${payload.taskId}`
          : payload.notificationType === 'overdue_assignee'
            ? `🚨 Task Overdue — #${payload.taskId}: ${payload.title}`
            : `🛡️ Management Escalation — Overdue Task #${payload.taskId}`;

      const description =
        payload.notificationType === 'due_now'
          ? `Your assigned task **${payload.title}** has reached its deadline.`
          : payload.notificationType === 'overdue_assignee'
            ? `Your assigned task **${payload.title}** is now **OVERDUE**. Please update or complete it as soon as possible.`
            : `Task **#${payload.taskId}: ${payload.title}** assigned to **${payload.assigneeName}** remains overdue.`;

      const embed = new EmbedBuilder()
        .setColor(isOverdue ? DANGER_COLOR : WARNING_COLOR)
        .setTitle(title.slice(0, 256))
        .setDescription(description)
        .addFields(
          { name: 'Category', value: `\`${payload.projectCategory}\``, inline: true },
          { name: 'Priority', value: payload.priority, inline: true },
          { name: 'Deadline (IST)', value: payload.deadlineFormatted, inline: true },
          { name: 'Status', value: payload.countdownLabel, inline: false }
        )
        .setFooter({ text: 'Bloxberry Labs Project Management' })
        .setTimestamp();

      await user.send({ embeds: [embed] });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Discord DM error';
      return { ok: false, error: message };
    }
  }
}

export interface BotHandle {
  client: Client;
  transport: NotificationTransport;
  isConnected: () => boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createDiscordBot(): BotHandle {
  const env = getEnv();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    rest: {
      retries: 3,
    },
  });

  // Guard against duplicate interaction processing during rapid double-clicks/reconnects
  const seenInteractions = new Set<string>();
  const trackInteraction = (id: string): boolean => {
    if (seenInteractions.has(id)) return false;
    seenInteractions.add(id);
    setTimeout(() => seenInteractions.delete(id), 60_000).unref();
    return true;
  };

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Bot] Logged in as ${readyClient.user.tag} (${readyClient.guilds.cache.size} guilds)`);

    for (const guild of readyClient.guilds.cache.values()) {
      try {
        const storageChannel = await discordStorage.ensureStorageChannel(guild, readyClient.user);
        await discordStorage.loadFromChannel(guild.id, storageChannel);
      } catch (err) {
        console.error(`[Bot] Storage channel init error (${guild.id}):`, err instanceof Error ? err.message : err);
      }

      await syncGuildMetadata(guild).catch((err) =>
        console.error(`[Bot] Guild sync error (${guild.id}):`, err instanceof Error ? err.message : err)
      );
      // Warm member cache cleanly
      try {
        const members = await guild.members.fetch();
        for (const member of members.values()) {
          if (!member.user.bot) {
            await syncDiscordUser(member.user, member);
          }
        }
      } catch (err) {
        console.warn(`[Bot] Member sync skipped for ${guild.id}:`, err instanceof Error ? err.message : err);
      }
    }

    if (env.DEPLOY_COMMANDS_ON_BOOT && env.DISCORD_TOKEN) {
      try {
        const clientId = env.DISCORD_CLIENT_ID || readyClient.user.id;
        if (env.DISCORD_GUILD_ID) {
          await registerSlashCommands({
            token: env.DISCORD_TOKEN,
            clientId,
            guildId: env.DISCORD_GUILD_ID,
          });
        } else {
          for (const guild of readyClient.guilds.cache.values()) {
            await registerSlashCommands({
              token: env.DISCORD_TOKEN,
              clientId,
              guildId: guild.id,
            });
          }
        }
      } catch (err) {
        console.error('[Bot] Failed to deploy commands on boot:', err instanceof Error ? err.message : err);
      }
    }
  });

  client.on(Events.GuildUpdate, async (_oldGuild, newGuild) => {
    await syncGuildMetadata(newGuild).catch(() => null);
  });

  client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
    if (!newMember.user.bot) {
      await syncDiscordUser(newMember.user, newMember).catch(() => null);
    }
  });

  client.on(Events.GuildRoleUpdate, async (_oldRole, newRole) => {
    await upsertDiscordRole(newRole.guild.id, newRole).catch(() => null);
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      await handlePrefixMessage(message);
    } catch (err) {
      console.error('[Bot] Prefix handler error:', err instanceof Error ? err.message : err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!trackInteraction(interaction.id)) return;

    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commandMap.get(interaction.commandName);
        if (!cmd) {
          await interaction.reply({
            content: '❌ Unknown command.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await cmd.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (
          interaction.customId.startsWith('nav:') ||
          interaction.customId.startsWith('tasks:') ||
          interaction.customId.startsWith('roadmap:') ||
          interaction.customId.startsWith('milestone:') ||
          interaction.customId.startsWith('settings:') ||
          interaction.customId.startsWith('task:add_goal_modal') ||
          interaction.customId.startsWith('task:toggle_complete:') ||
          interaction.customId.startsWith('task:start:') ||
          interaction.customId.startsWith('task:reassign_menu:') ||
          interaction.customId.startsWith('task:delete_confirm:')
        ) {
          await handleY2kButtonInteraction(interaction);
          return;
        }
        await handleButtonInteraction(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        if (
          interaction.customId.startsWith('modal:')
        ) {
          await handleY2kModalSubmit(interaction);
          return;
        }
        await handleModalSubmit(interaction);
        return;
      }

      if (interaction.isUserSelectMenu()) {
        if (
          interaction.customId.startsWith('task:assign_member_for_goal:') ||
          interaction.customId.startsWith('task:reassign_select:') ||
          interaction.customId.startsWith('settings:auth_user_select')
        ) {
          await handleY2kSelectInteraction(interaction);
          return;
        }
        await handleUserSelectInteraction(interaction);
        return;
      }

      if (interaction.isRoleSelectMenu()) {
        if (interaction.customId.startsWith('settings:auth_role_select')) {
          await handleY2kSelectInteraction(interaction);
          return;
        }
      }

      if (interaction.isStringSelectMenu()) {
        if (
          interaction.customId.startsWith('tasks:') ||
          interaction.customId.startsWith('roadmap:')
        ) {
          await handleY2kSelectInteraction(interaction);
          return;
        }
        await handleStringSelectInteraction(interaction);
      }
    } catch (err) {
      console.error('[Bot] Interaction error:', err instanceof Error ? err.message : err);
      if (interaction.isRepliable()) {
        const payload = {
          content: `⚠️ Something went wrong: ${err instanceof Error ? err.message : 'Internal error'}`,
          flags: MessageFlags.Ephemeral as const,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => null);
        } else {
          await interaction.reply(payload).catch(() => null);
        }
      }
    }
  });

  client.on(Events.Error, (err) => {
    console.error('[Bot] Client error:', err.message);
  });

  client.rest.on('rateLimited', (info) => {
    console.warn(`[Bot] Rate limited on ${info.route} (retryAfter=${info.retryAfter}ms)`);
  });

  const transport = new DiscordNotificationTransport(client);

  return {
    client,
    transport,
    isConnected: () => client.isReady(),
    start: async () => {
      if (!env.DISCORD_TOKEN) {
        console.warn('[Bot] DISCORD_TOKEN is not configured — running health endpoint without live Discord gateway.');
        return;
      }
      await client.login(env.DISCORD_TOKEN);
    },
    stop: async () => {
      if (client.isReady() || client.ws.status !== 3) {
        await client.destroy();
        console.log('[Bot] Discord client destroyed.');
      }
    },
  };
}
