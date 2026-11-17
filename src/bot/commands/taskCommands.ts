import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { parseDeadlineInput } from '../../domain/countdown.js';
import { canManageDeadlines, canViewStaffTasks } from '../../domain/permissions.js';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from '../../domain/types.js';
import {
  attachDiscordMessageRef,
  completeTask,
  createTask,
  deleteTask,
  getOrganizedTasksOverview,
  getTaskById,
  getTaskHistory,
  listTasks,
  updateTask,
} from '../../services/taskService.js';
import { resolveInteractionContext, syncTargetMember } from '../context.js';
import {
  buildChecklistHubComponents,
  buildChecklistHubEmbed,
  buildPaginatedTaskListEmbed,
  buildPaginationComponents,
  buildTaskCardComponents,
  buildTaskCardEmbed,
  DANGER_COLOR,
  INFO_COLOR,
  SUCCESS_COLOR,
} from '../embeds/taskEmbeds.js';
import { buildOverviewEmbedForGuild } from '../interactions/checklistHandlers.js';
import type { BotCommand } from './index.js';

export const taskCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('checklist')
      .setDescription('Open the interactive Bloxberry Labs task & checklist hub'),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      await interaction.reply({
        embeds: [buildChecklistHubEmbed(guild.name)],
        components: [buildChecklistHubComponents()],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('add-task')
      .setDescription('Create a new task and assign it to any server member')
      .addStringOption((opt) =>
        opt.setName('title').setDescription('Short task title').setRequired(true).setMaxLength(180)
      )
      .addUserOption((opt) =>
        opt.setName('assignee').setDescription('Staff member assigned to this task').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Task details & requirements').setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('category')
          .setDescription('Project or category (e.g. Core Gameplay, UI/UX, Map)')
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('priority')
          .setDescription('Task priority')
          .setRequired(false)
          .addChoices(
            ...TASK_PRIORITIES.map((p) => ({
              name: p,
              value: p,
            }))
          )
      )
      .addStringOption((opt) =>
        opt
          .setName('deadline')
          .setDescription('Optional deadline (Asia/Kolkata, e.g. 2026-11-25 18:00 or "in 4h") — Authorised only')
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('milestone_id')
          .setDescription('Optional Roadmap Milestone ID to link this task to')
          .setRequired(false)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      const env = getEnv();

      const title = interaction.options.getString('title', true);
      const assignee = interaction.options.getUser('assignee', true);
      const description = interaction.options.getString('description') ?? '';
      const projectCategory = interaction.options.getString('category') ?? 'General';
      const priority = (interaction.options.getString('priority') ?? 'Medium') as TaskPriority;
      const rawDeadline = interaction.options.getString('deadline');
      const milestoneId = interaction.options.getInteger('milestone_id');

      let deadlineAt: Date | null = null;
      if (rawDeadline) {
        if (!canManageDeadlines(ctx)) {
          await interaction.reply({
            content:
              '⛔ **Deadline Permission Denied:** You can create tasks without a deadline, or ask the server owner / an authorised manager to set the deadline.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
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

      await syncTargetMember(guild, assignee);

      const created = await createTask(
        {
          guildId: guild.id,
          title,
          description,
          projectCategory,
          priority,
          assigneeId: assignee.id,
          deadlineAt,
          timezone: env.DEFAULT_TIMEZONE,
          milestoneId,
          actorName,
        },
        ctx
      );

      const reply = await interaction.reply({
        embeds: [buildTaskCardEmbed(created)],
        components: buildTaskCardComponents(created),
        fetchReply: true,
      });

      await attachDiscordMessageRef(created.id, reply.channelId, reply.id);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('my-tasks')
      .setDescription('View your personal assigned tasks')
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('Filter by status')
          .setRequired(false)
          .addChoices(...TASK_STATUSES.map((s) => ({ name: s, value: s })))
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, user, actorName } = await resolveInteractionContext(interaction);
      const status = interaction.options.getString('status') as TaskStatus | null;

      const tasks = await listTasks({
        guildId: guild.id,
        assigneeId: user.id,
        status: status ?? undefined,
      });

      const view = buildPaginatedTaskListEmbed({
        title: `👤 My Tasks — ${actorName}${status ? ` (${status})` : ''}`,
        tasks,
        page: 1,
        color: INFO_COLOR,
        emptyMessage: 'You currently have no matching assigned tasks.',
      });

      const components = buildPaginationComponents({
        prefix: `page:my_tasks:${status ?? 'all'}`,
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });

      await interaction.reply({
        embeds: [view.embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('tasks')
      .setDescription('Display an organised overview of Bloxberry Labs tasks')
      .addStringOption((opt) =>
        opt
          .setName('view')
          .setDescription('Choose how to view server tasks')
          .setRequired(false)
          .addChoices(
            { name: 'Summary Overview', value: 'overview' },
            { name: 'All Tasks (Paginated)', value: 'all' },
            { name: 'Due Today', value: 'due_today' },
            { name: 'Upcoming Deadlines', value: 'upcoming' },
            { name: 'Overdue Tasks', value: 'overdue' },
            { name: 'In Progress', value: 'in_progress' },
            { name: 'Completed Tasks', value: 'completed' }
          )
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const env = getEnv();
      const viewMode = interaction.options.getString('view') ?? 'overview';

      if (viewMode === 'overview') {
        const embed = await buildOverviewEmbedForGuild(guild.id);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      const overview = await getOrganizedTasksOverview(guild.id, env.DEFAULT_TIMEZONE);
      let list = overview.all;
      let title = '📋 All Server Tasks';
      let color: number | undefined;

      if (viewMode === 'due_today') {
        list = overview.dueToday;
        title = '📅 Tasks Due Today (IST)';
      } else if (viewMode === 'upcoming') {
        list = overview.upcomingDeadlines;
        title = '⏳ Upcoming Deadlines';
      } else if (viewMode === 'overdue') {
        list = overview.overdue;
        title = '🚨 Overdue Tasks';
        color = DANGER_COLOR;
      } else if (viewMode === 'in_progress') {
        list = overview.inProgress;
        title = '🔄 Tasks In Progress';
        color = INFO_COLOR;
      } else if (viewMode === 'completed') {
        list = overview.completed;
        title = '✅ Completed Tasks';
        color = SUCCESS_COLOR;
      }

      const pageView = buildPaginatedTaskListEmbed({
        title,
        tasks: list,
        page: 1,
        color,
      });
      const components = buildPaginationComponents({
        prefix: `page:all_tasks:${viewMode}`,
        page: pageView.currentPage,
        totalPages: pageView.totalPages,
        pageTasks: pageView.pageTasks,
      });

      await interaction.reply({ embeds: [pageView.embed], components });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('staff-tasks')
      .setDescription('View tasks assigned to a specific staff member (Authorised management / self)')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Staff member to inspect').setRequired(true)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx } = await resolveInteractionContext(interaction);
      const target = interaction.options.getUser('user', true);

      if (!canViewStaffTasks(ctx, target.id)) {
        await interaction.reply({
          content:
            '⛔ Access restricted: only authorised management members or the server owner can inspect another staff member’s task list.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await syncTargetMember(guild, target);
      const tasks = await listTasks({ guildId: guild.id, assigneeId: target.id });

      const view = buildPaginatedTaskListEmbed({
        title: `👤 Staff Tasks — ${target.username}`,
        tasks,
        page: 1,
        emptyMessage: `<@${target.id}> has no assigned tasks.`,
      });

      const components = buildPaginationComponents({
        prefix: `page:staff_tasks:${target.id}`,
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });

      await interaction.reply({
        embeds: [view.embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('task-details')
      .setDescription('Inspect full details, countdown, and history of a task')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID number').setRequired(true).setMinValue(1)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const taskId = interaction.options.getInteger('task_id', true);
      const task = await getTaskById(taskId, guild.id);
      if (!task) {
        await interaction.reply({
          content: `❌ Task #${taskId} was not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const history = await getTaskHistory(taskId);
      const embed = buildTaskCardEmbed(task);
      if (history.length > 0) {
        embed.addFields({
          name: '📜 Recent Activity',
          value: history
            .slice(0, 5)
            .map(
              (h) =>
                `• **${h.action}** by ${h.actorName ?? h.actorId} (<t:${Math.floor(h.createdAt.getTime() / 1000)}:R>)`
            )
            .join('\n'),
          inline: false,
        });
      }

      await interaction.reply({
        embeds: [embed],
        components: buildTaskCardComponents(task),
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('task-edit')
      .setDescription('Edit an existing task (creator or authorised management)')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt.setName('title').setDescription('New title').setRequired(false).setMaxLength(180)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('New description').setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName('assignee').setDescription('Reassign to another staff member').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('category').setDescription('New project/category').setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('priority')
          .setDescription('New priority')
          .setRequired(false)
          .addChoices(...TASK_PRIORITIES.map((p) => ({ name: p, value: p })))
      )
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('New status')
          .setRequired(false)
          .addChoices(...TASK_STATUSES.map((s) => ({ name: s, value: s })))
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      const taskId = interaction.options.getInteger('task_id', true);
      const assignee = interaction.options.getUser('assignee');

      if (assignee) {
        await syncTargetMember(guild, assignee);
      }

      try {
        const updated = await updateTask(
          taskId,
          {
            title: interaction.options.getString('title') ?? undefined,
            description: interaction.options.getString('description') ?? undefined,
            assigneeId: assignee ? assignee.id : undefined,
            projectCategory: interaction.options.getString('category') ?? undefined,
            priority: (interaction.options.getString('priority') as TaskPriority) ?? undefined,
            status: (interaction.options.getString('status') as TaskStatus) ?? undefined,
            actorName,
          },
          ctx
        );

        await interaction.reply({
          content: `✅ Updated **Task #${updated.id}**.`,
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to edit task.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('task-delete')
      .setDescription('Delete a task (creator or authorised management)')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      const taskId = interaction.options.getInteger('task_id', true);
      try {
        const removed = await deleteTask(taskId, ctx, actorName);
        await interaction.reply({
          content: `🗑️ Deleted **Task #${taskId}: ${removed.title}**.`,
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to delete task.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('task-complete')
      .setDescription('Mark a task as completed')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
      const taskId = interaction.options.getInteger('task_id', true);
      try {
        const updated = await completeTask(taskId, ctx, actorName);

        // Update linked channel message if one exists
        if (updated.discordChannelId && updated.discordMessageId) {
          const ch = await guild.channels.fetch(updated.discordChannelId).catch(() => null);
          if (ch && ch.isTextBased()) {
            const msg = await ch.messages.fetch(updated.discordMessageId).catch(() => null);
            if (msg) {
              await msg
                .edit({
                  embeds: [buildTaskCardEmbed(updated)],
                  components: buildTaskCardComponents(updated),
                })
                .catch(() => null);
            }
          }
        }

        await interaction.reply({
          content: `✅ **Task #${updated.id}** marked as **COMPLETED**!`,
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to complete task.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
];
