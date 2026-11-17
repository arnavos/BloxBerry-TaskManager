import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { parseDeadlineInput } from '../../domain/countdown.js';
import { canManageRoadmap } from '../../domain/permissions.js';
import { renderProgressBar } from '../../domain/roadmap.js';
import {
  MILESTONE_STATUSES,
  PHASE_STATUSES,
  type MilestoneStatus,
  type PhaseStatus,
} from '../../domain/types.js';
import {
  addDevelopmentPhase,
  addMilestone,
  createProject,
  getProjectRoadmapById,
  listProjectsWithRoadmaps,
  reorderMilestones,
  updateMilestone,
} from '../../services/roadmapService.js';
import { resolveInteractionContext, syncTargetMember } from '../context.js';
import { buildMilestoneDetailEmbed, buildRoadmapEmbed, milestoneStatusEmoji } from '../embeds/roadmapEmbeds.js';
import { BRAND_COLOR } from '../embeds/taskEmbeds.js';
import type { BotCommand } from './index.js';

export const roadmapCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('roadmap')
      .setDescription('Display the Roblox game development progression roadmap')
      .addIntegerOption((opt) =>
        opt.setName('project_id').setDescription('Optional project ID').setRequired(false)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const projectId = interaction.options.getInteger('project_id');
      const projects = await listProjectsWithRoadmaps(guild.id);

      if (projects.length === 0) {
        await interaction.reply({
          content:
            '🗺️ No roadmap project exists yet. Authorised management can create one with `/roadmap-create name:"Bloxberry Flagship Game"`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const target = projectId ? projects.find((p) => p.id === projectId) : projects[0];
      if (!target) {
        await interaction.reply({
          content: `❌ Roadmap project #${projectId} was not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({ embeds: [buildRoadmapEmbed(target)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roadmap-create')
      .setDescription('Create a new game development roadmap project (Authorised management)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Project / Roblox game name').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Project overview').setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('seed_stages')
          .setDescription('Pre-populate with the 12 editable Roblox development stages (default: true)')
          .setRequired(false)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageRoadmap(ctx)) {
        await interaction.reply({
          content: '⛔ Only authorised management members or the server owner can create roadmaps.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const name = interaction.options.getString('name', true);
      const description = interaction.options.getString('description') ?? '';
      const seedDefaultStages = interaction.options.getBoolean('seed_stages') ?? true;

      const created = await createProject(
        {
          guildId: guild.id,
          name,
          description,
          seedDefaultStages,
          actorName,
        },
        ctx
      );

      await interaction.reply({
        content: `✅ Created roadmap project **#${created.id}: ${created.name}**!`,
        embeds: [buildRoadmapEmbed(created)],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roadmap-add-milestone')
      .setDescription('Add a milestone or development phase to a roadmap (Authorised management)')
      .addIntegerOption((opt) =>
        opt.setName('project_id').setDescription('Roadmap Project ID').setRequired(true).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt.setName('title').setDescription('Milestone title').setRequired(true).setMaxLength(150)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Milestone scope & deliverables').setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName('owner').setDescription('Milestone owner').setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('Initial status')
          .setRequired(false)
          .addChoices(...MILESTONE_STATUSES.map((s) => ({ name: s, value: s })))
      )
      .addStringOption((opt) =>
        opt
          .setName('deadline')
          .setDescription('Milestone deadline (e.g. 2026-12-15 18:00)')
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('sort_order')
          .setDescription('Stage position number')
          .setRequired(false)
          .setMinValue(1)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageRoadmap(ctx)) {
        await interaction.reply({
          content: '⛔ Only authorised management members can add milestones.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const env = getEnv();
      const projectId = interaction.options.getInteger('project_id', true);
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description') ?? '';
      const owner = interaction.options.getUser('owner');
      const status = (interaction.options.getString('status') as MilestoneStatus) ?? 'Not Started';
      const rawDeadline = interaction.options.getString('deadline');
      const sortOrder = interaction.options.getInteger('sort_order') ?? undefined;

      let deadlineAt: Date | null = null;
      if (rawDeadline) {
        try {
          deadlineAt = parseDeadlineInput(rawDeadline, env.DEFAULT_TIMEZONE).date;
        } catch (err) {
          await interaction.reply({
            content: `❌ ${err instanceof Error ? err.message : 'Invalid deadline format.'}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      if (owner) await syncTargetMember(guild, owner);

      try {
        const milestone = await addMilestone(
          {
            guildId: guild.id,
            projectId,
            title,
            description,
            ownerId: owner?.id ?? null,
            status,
            deadlineAt,
            sortOrder,
            actorName,
          },
          ctx
        );

        await interaction.reply({
          content: `✅ Added milestone **#${milestone.id}: ${milestone.title}** to Project #${projectId}.`,
          embeds: [buildMilestoneDetailEmbed(milestone, `Project #${projectId}`)],
        });
      } catch (err) {
        await interaction.reply({
          content: `❌ ${err instanceof Error ? err.message : 'Failed to add milestone.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roadmap-update')
      .setDescription('Update a milestone, add a phase, or reorder stages (Authorised management)')
      .addIntegerOption((opt) =>
        opt.setName('milestone_id').setDescription('Milestone ID').setRequired(true).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt.setName('status').setDescription('Milestone status').setRequired(false).addChoices(
          ...MILESTONE_STATUSES.map((s) => ({ name: s, value: s }))
        )
      )
      .addIntegerOption((opt) =>
        opt
          .setName('progress')
          .setDescription('Progress percentage (0-100)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(100)
      )
      .addStringOption((opt) =>
        opt.setName('title').setDescription('Updated title').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Updated description').setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName('owner').setDescription('Assign milestone owner').setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('deadline')
          .setDescription('New deadline (or "clear" to remove)')
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('sort_order')
          .setDescription('Move milestone to stage order position')
          .setRequired(false)
          .setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName('add_phase')
          .setDescription('Optional: add a new development phase under this milestone')
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('phase_status')
          .setDescription('Initial status for the new phase')
          .setRequired(false)
          .addChoices(...PHASE_STATUSES.map((s) => ({ name: s, value: s })))
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageRoadmap(ctx)) {
        await interaction.reply({
          content: '⛔ Only authorised management members can update the roadmap.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const env = getEnv();
      const milestoneId = interaction.options.getInteger('milestone_id', true);
      const status = (interaction.options.getString('status') as MilestoneStatus) ?? undefined;
      const progressPercent = interaction.options.getInteger('progress') ?? undefined;
      const title = interaction.options.getString('title') ?? undefined;
      const description = interaction.options.getString('description') ?? undefined;
      const owner = interaction.options.getUser('owner');
      const rawDeadline = interaction.options.getString('deadline');
      const sortOrder = interaction.options.getInteger('sort_order') ?? undefined;
      const addPhaseTitle = interaction.options.getString('add_phase');
      const phaseStatus = (interaction.options.getString('phase_status') as PhaseStatus) ?? 'Not Started';

      let deadlineAt: Date | undefined;
      let clearDeadline = false;
      if (rawDeadline) {
        if (rawDeadline.trim().toLowerCase() === 'clear') {
          clearDeadline = true;
        } else {
          try {
            deadlineAt = parseDeadlineInput(rawDeadline, env.DEFAULT_TIMEZONE).date;
          } catch (err) {
            await interaction.reply({
              content: `❌ ${err instanceof Error ? err.message : 'Invalid deadline format.'}`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        }
      }

      if (owner) await syncTargetMember(guild, owner);

      try {
        let updated = await updateMilestone(
          milestoneId,
          {
            guildId: guild.id,
            title,
            description,
            status,
            ownerId: owner ? owner.id : undefined,
            deadlineAt,
            clearDeadline,
            progressPercent,
            sortOrder,
            actorName,
          },
          ctx
        );

        if (sortOrder !== undefined) {
          const proj = await getProjectRoadmapById(updated.projectId, guild.id);
          if (proj) {
            const others = proj.milestones
              .filter((m) => m.id !== updated.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((m) => m.id);
            const idx = Math.max(0, Math.min(others.length, sortOrder - 1));
            others.splice(idx, 0, updated.id);
            await reorderMilestones(proj.id, others, ctx, actorName);
          }
        }

        if (addPhaseTitle) {
          await addDevelopmentPhase(
            {
              guildId: guild.id,
              milestoneId,
              title: addPhaseTitle,
              status: phaseStatus,
              actorName,
            },
            ctx
          );
        }

        const refreshedProj = await getProjectRoadmapById(updated.projectId, guild.id);
        updated = refreshedProj?.milestones.find((m) => m.id === milestoneId) ?? updated;

        await interaction.reply({
          content: `✅ Updated **Milestone #${updated.id}: ${updated.title}**.`,
          embeds: [buildMilestoneDetailEmbed(updated, refreshedProj?.name ?? 'Roadmap')],
        });
      } catch (err) {
        await interaction.reply({
          content: `❌ ${err instanceof Error ? err.message : 'Failed to update milestone.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roadmap-progress')
      .setDescription('View dynamic project progress breakdown across all milestones')
      .addIntegerOption((opt) =>
        opt.setName('project_id').setDescription('Optional project ID').setRequired(false)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const projectId = interaction.options.getInteger('project_id');
      const projects = await listProjectsWithRoadmaps(guild.id);
      const proj = projectId ? projects.find((p) => p.id === projectId) : projects[0];

      if (!proj) {
        await interaction.reply({
          content: '❌ No roadmap project found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const p = proj.progress;
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`📈 ${proj.name} — Progress Report`)
        .setDescription(`\`${renderProgressBar(p.overallPercent, 20)}\``)
        .addFields(
          { name: 'Total Milestones', value: String(p.totalMilestones), inline: true },
          { name: '✅ Completed', value: String(p.completedCount), inline: true },
          { name: '🚀 In Progress', value: String(p.inProgressCount), inline: true },
          { name: '📝 Planning', value: String(p.planningCount), inline: true },
          { name: '⛔ Blocked', value: String(p.blockedCount), inline: true },
          { name: '⬜ Not Started', value: String(p.notStartedCount), inline: true }
        )
        .setTimestamp();

      if (proj.milestones.length > 0) {
        embed.addFields({
          name: 'Stage Breakdown',
          value: proj.milestones
            .map(
              (m) =>
                `${milestoneStatusEmoji(m.status)} **${m.sortOrder}. ${m.title}** — \`${renderProgressBar(m.progressPercent, 8)}\` (${m.status})`
            )
            .join('\n')
            .slice(0, 1024),
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roadmap-view')
      .setDescription('Inspect a specific roadmap project or milestone in detail')
      .addIntegerOption((opt) =>
        opt.setName('project_id').setDescription('Project ID').setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt.setName('milestone_id').setDescription('Specific Milestone ID to inspect').setRequired(false)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const projectId = interaction.options.getInteger('project_id');
      const milestoneId = interaction.options.getInteger('milestone_id');
      const projects = await listProjectsWithRoadmaps(guild.id);

      if (projects.length === 0) {
        await interaction.reply({
          content: '🗺️ No roadmap projects found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (milestoneId) {
        for (const proj of projects) {
          const m = proj.milestones.find((item) => item.id === milestoneId);
          if (m) {
            await interaction.reply({ embeds: [buildMilestoneDetailEmbed(m, proj.name)] });
            return;
          }
        }
        await interaction.reply({
          content: `❌ Milestone #${milestoneId} not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const proj = projectId ? projects.find((p) => p.id === projectId) : projects[0];
      if (!proj) {
        await interaction.reply({
          content: `❌ Project #${projectId} not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({ embeds: [buildRoadmapEmbed(proj)] });
    },
  },
];
