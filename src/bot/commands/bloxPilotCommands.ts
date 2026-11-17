import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { listTasks } from '../../services/taskService.js';
import { listProjectsWithRoadmaps } from '../../services/roadmapService.js';
import { resolveInteractionContext } from '../context.js';
import { buildY2kHomePanel } from '../embeds/y2kPanels.js';
import type { BotCommand } from './index.js';

export const bloxPilotCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('bloxpilot')
      .setDescription('Open the BloxPilot Y2K Developer Workspace & Control Centre'),
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
        embeds: [panel.embed],
        components: panel.components,
      });
    },
  },
];
