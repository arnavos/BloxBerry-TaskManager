import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { canManageDeadlines, isGuildOwner } from '../../domain/permissions.js';
import { listTasks } from '../../services/taskService.js';
import { listDeadlinePermissions } from '../../services/permissionService.js';
import { listProjectsWithRoadmaps } from '../../services/roadmapService.js';
import { resolveInteractionContext } from '../context.js';
import { BRAND_COLOR, INFO_COLOR, SUCCESS_COLOR } from '../embeds/taskEmbeds.js';
import { STORAGE_CHANNEL_NAME } from '../../storage/discordStorage.js';
import { buildY2kHomePanel, buildY2kSettingsPanel } from '../embeds/y2kPanels.js';
import type { BotCommand } from './index.js';

export const adminCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('management-panel')
      .setDescription('View Bloxberry Labs staff management & permission status'),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx } = await resolveInteractionContext(interaction);
      const perms = await listDeadlinePermissions(guild.id);
      const panel = buildY2kSettingsPanel({
        guildId: guild.id,
        isOwner: isGuildOwner(ctx),
        canManage: canManageDeadlines(ctx),
        authorisedUsers: perms.authorisedUsers,
        authorisedRoles: perms.authorisedRoles,
      });

      await interaction.reply({ embeds: [panel.embed], components: panel.components, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('bot-status')
      .setDescription('Inspect bot health, storage channel status, uptime, and scheduler status'),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const tasks = await listTasks({ guildId: guild.id });
      const overdue = tasks.filter((t) => t.status === 'Overdue').length;
      const completed = tasks.filter((t) => t.status === 'Completed').length;
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const secs = uptimeSec % 60;

      const embed = new EmbedBuilder()
        .setColor(SUCCESS_COLOR)
        .setTitle('🩺 Bloxberry Labs PM Bot — System Status')
        .addFields(
          { name: 'Gateway Ping', value: `${interaction.client.ws.ping} ms`, inline: true },
          { name: 'Storage Engine', value: `✅ Discord Channel (\`#${STORAGE_CHANNEL_NAME}\`)`, inline: true },
          { name: 'Process Uptime', value: `${hours}h ${mins}m ${secs}s`, inline: true },
          { name: 'Tasks Tracked', value: `${tasks.length} total (${overdue} overdue, ${completed} done)`, inline: true },
          { name: 'Default Timezone', value: getEnv().DEFAULT_TIMEZONE, inline: true },
          { name: 'Deployment Mode', value: 'Unified Render Web Service', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Open the BloxPilot Interactive Control Centre'),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, actorName } = await resolveInteractionContext(interaction);
      const tasks = await listTasks({ guildId: guild.id });
      const roadmaps = await listProjectsWithRoadmaps(guild.id);

      const panel = buildY2kHomePanel({
        guildId: guild.id,
        userName: actorName,
        project: roadmaps[0] ?? null,
        tasks,
      });

      await interaction.reply({
        content: '✦ **Welcome to BloxPilot Control Centre**. Use the interactive buttons and menus below to navigate your workspace.',
        embeds: [panel.embed],
        components: panel.components,
      });
    },
  },
];
