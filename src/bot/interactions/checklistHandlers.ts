import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { parseDeadlineInput } from '../../domain/countdown.js';
import { canEditOrDeleteTask, canManageDeadlines } from '../../domain/permissions.js';
import { TASK_PRIORITIES, type TaskPriority, type TaskStatus } from '../../domain/types.js';
import {
  attachDiscordMessageRef,
  completeTask,
  createTask,
  deleteTask,
  getOrganizedTasksOverview,
  getTaskById,
  listTasks,
  PermissionError,
  updateTask,
} from '../../services/taskService.js';
import { resolveInteractionContext, syncTargetMember } from '../context.js';
import {
  BRAND_COLOR,
  buildPaginatedTaskListEmbed,
  buildPaginationComponents,
  buildTaskCardComponents,
  buildTaskCardEmbed,
  DANGER_COLOR,
  INFO_COLOR,
  SUCCESS_COLOR,
  WARNING_COLOR,
} from '../embeds/taskEmbeds.js';

function normalizePriority(raw: string): TaskPriority {
  const cleaned = raw.trim().toLowerCase();
  const match = TASK_PRIORITIES.find((p) => p.toLowerCase() === cleaned);
  if (!match && cleaned.length > 0) {
    throw new Error('Priority must be one of: Low, Medium, High, Urgent.');
  }
  return match ?? 'Medium';
}

export async function buildOverviewEmbedForGuild(guildId: string) {
  const env = getEnv();
  const overview = await getOrganizedTasksOverview(guildId, env.DEFAULT_TIMEZONE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Bloxberry Labs — Task Overview')
    .setDescription(
      [
        `**Total:** ${overview.all.length} • **In Progress:** ${overview.inProgress.length} • **Overdue:** ${overview.overdue.length} • **Completed:** ${overview.completed.length}`,
      ].join('\n')
    )
    .setTimestamp();

  embed.addFields(
    {
      name: `📅 Due Today (${overview.dueToday.length})`,
      value:
        overview.dueToday
          .slice(0, 5)
          .map((t) => `• \`#${t.id}\` **${t.title}** — <@${t.assigneeId}> (${t.countdown.label})`)
          .join('\n') || '*Nothing due today.*',
      inline: false,
    },
    {
      name: `🚨 Overdue (${overview.overdue.length})`,
      value:
        overview.overdue
          .slice(0, 5)
          .map((t) => `• \`#${t.id}\` **${t.title}** — <@${t.assigneeId}> (${t.countdown.label})`)
          .join('\n') || '*No overdue tasks.*',
      inline: false,
    },
    {
      name: `⏳ Upcoming Deadlines (${overview.upcomingDeadlines.length})`,
      value:
        overview.upcomingDeadlines
          .slice(0, 5)
          .map((t) => `• \`#${t.id}\` **${t.title}** — ${t.countdown.label}`)
          .join('\n') || '*No upcoming deadlines.*',
      inline: false,
    },
    {
      name: '👥 Staff Workload',
      value:
        overview.byStaff
          .slice(0, 8)
          .map(
            (s) =>
              `• **${s.displayName}**: ${s.pendingCount} pending (${s.overdueCount} overdue, ${s.completedCount} done)`
          )
          .join('\n') || '*No assigned staff tasks yet.*',
      inline: false,
    }
  );

  return embed;
}

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const namespace = parts[0];

  if (namespace === 'checklist') {
    const action = parts[1];
    if (action === 'add_goal') {
      const modal = new ModalBuilder()
        .setCustomId('modal:add_goal')
        .setTitle('➕ Add Bloxberry Labs Goal');

      const titleInput = new TextInputBuilder()
        .setCustomId('task_title')
        .setLabel('Task Title')
        .setPlaceholder('e.g., Implement pet inventory UI animations')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(180)
        .setRequired(true);

      const descInput = new TextInputBuilder()
        .setCustomId('task_description')
        .setLabel('Task Description')
        .setPlaceholder('Details, acceptance criteria, or Roblox place references...')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1500)
        .setRequired(false);

      const categoryInput = new TextInputBuilder()
        .setCustomId('task_category')
        .setLabel('Project / Category')
        .setPlaceholder('e.g., Core Gameplay, UI/UX, Map, Audio')
        .setValue('General')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true);

      const priorityInput = new TextInputBuilder()
        .setCustomId('task_priority')
        .setLabel('Priority (Low, Medium, High, Urgent)')
        .setPlaceholder('Low | Medium | High | Urgent')
        .setValue('Medium')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(16)
        .setRequired(true);

      const deadlineInput = new TextInputBuilder()
        .setCustomId('task_deadline')
        .setLabel('Deadline (Optional — Authorised Users Only)')
        .setPlaceholder('e.g. 2026-11-25 18:00 or "in 4 hours" (IST)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(priorityInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (action === 'view_all') {
      const page = Number(parts[2] ?? '1');
      const { guild } = await resolveInteractionContext(interaction);
      const tasks = await listTasks({ guildId: guild.id });
      const view = buildPaginatedTaskListEmbed({
        title: '📋 Server Checklists & Tasks',
        tasks,
        page,
        emptyMessage: 'No tasks created yet. Click **➕ Add Goal** to create the first one!',
      });
      const components = buildPaginationComponents({
        prefix: 'checklist:view_all',
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });
      await interaction.reply({
        embeds: [view.embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'my_tasks') {
      const page = Number(parts[2] ?? '1');
      const { guild, user } = await resolveInteractionContext(interaction);
      const tasks = await listTasks({ guildId: guild.id, assigneeId: user.id });
      const view = buildPaginatedTaskListEmbed({
        title: `👤 My Assigned Tasks — ${user.username}`,
        tasks,
        page,
        color: INFO_COLOR,
        emptyMessage: 'You have no assigned tasks right now.',
      });
      const components = buildPaginationComponents({
        prefix: 'checklist:my_tasks',
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });
      await interaction.reply({
        embeds: [view.embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'overview') {
      const { guild } = await resolveInteractionContext(interaction);
      const embed = await buildOverviewEmbedForGuild(guild.id);
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (namespace === 'page') {
    const scope = parts[1];
    const extra = parts[2];
    const page = Number(parts[3] ?? '1');
    const { guild, user } = await resolveInteractionContext(interaction);

    if (scope === 'my_tasks') {
      const statusFilter = extra === 'all' ? undefined : (extra as TaskStatus);
      const tasks = await listTasks({
        guildId: guild.id,
        assigneeId: user.id,
        status: statusFilter,
      });
      const view = buildPaginatedTaskListEmbed({
        title: `👤 My Assigned Tasks`,
        tasks,
        page,
        color: INFO_COLOR,
      });
      const components = buildPaginationComponents({
        prefix: `page:my_tasks:${extra}`,
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });
      await interaction.update({ embeds: [view.embed], components });
      return;
    }

    if (scope === 'staff_tasks') {
      const targetUserId = extra;
      const tasks = await listTasks({ guildId: guild.id, assigneeId: targetUserId });
      const view = buildPaginatedTaskListEmbed({
        title: `👤 Staff Tasks`,
        tasks,
        page,
      });
      const components = buildPaginationComponents({
        prefix: `page:staff_tasks:${targetUserId}`,
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });
      await interaction.update({ embeds: [view.embed], components });
      return;
    }

    if (scope === 'all_tasks') {
      const filterKey = extra;
      const all = await listTasks({ guildId: guild.id });
      const filtered =
        filterKey === 'overdue'
          ? all.filter((t) => t.status === 'Overdue')
          : filterKey === 'completed'
            ? all.filter((t) => t.status === 'Completed')
            : filterKey === 'in_progress'
              ? all.filter((t) => t.status === 'In Progress')
              : all;

      const view = buildPaginatedTaskListEmbed({
        title: `📋 Tasks (${filterKey.replace('_', ' ')})`,
        tasks: filtered,
        page,
      });
      const components = buildPaginationComponents({
        prefix: `page:all_tasks:${filterKey}`,
        page: view.currentPage,
        totalPages: view.totalPages,
        pageTasks: view.pageTasks,
      });
      await interaction.update({ embeds: [view.embed], components });
      return;
    }
  }

  if (namespace === 'task') {
    const action = parts[1];
    const taskId = Number(parts[2]);

    if (action === 'edit_modal') {
      const { guild, ctx } = await resolveInteractionContext(interaction);
      const task = await getTaskById(taskId, guild.id);
      if (!task) {
        await interaction.reply({
          content: `❌ Task #${taskId} no longer exists.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!canEditOrDeleteTask(ctx, { creatorId: task.creatorId })) {
        await interaction.reply({
          content: '⛔ Only the task creator or authorised management members can edit this task.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal:edit_task:${task.id}`)
        .setTitle(`✏️ Edit Task #${task.id}`);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('task_title')
            .setLabel('Task Title')
            .setStyle(TextInputStyle.Short)
            .setValue(task.title.slice(0, 180))
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('task_description')
            .setLabel('Task Description')
            .setStyle(TextInputStyle.Paragraph)
            .setValue((task.description || '').slice(0, 1500))
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('task_category')
            .setLabel('Project / Category')
            .setStyle(TextInputStyle.Short)
            .setValue(task.projectCategory.slice(0, 80))
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('task_priority')
            .setLabel('Priority (Low, Medium, High, Urgent)')
            .setStyle(TextInputStyle.Short)
            .setValue(task.priority)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('task_deadline')
            .setLabel('Deadline (leave blank to keep, "clear" to remove)')
            .setPlaceholder('e.g. 2026-11-28 18:00 or "clear"')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (action === 'complete') {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      try {
        const updated = await completeTask(taskId, ctx, actorName);
        await interaction.update({
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to complete task.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (action === 'status') {
      const nextStatus = parts[3] as TaskStatus;
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      try {
        const updated = await updateTask(
          taskId,
          { status: nextStatus, actorName },
          ctx
        );
        await interaction.update({
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to update status.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (action === 'delete') {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      try {
        const removed = await deleteTask(taskId, ctx, actorName);
        const deletedEmbed = new EmbedBuilder()
          .setColor(DANGER_COLOR)
          .setTitle(`🗑️ Task #${taskId} Deleted`)
          .setDescription(`**${removed.title}** was removed by <@${ctx.userId}>.`)
          .setTimestamp();
        await interaction.update({ embeds: [deletedEmbed], components: [] });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Unable to delete task.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
  }
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const env = getEnv();

  if (interaction.customId === 'modal:add_goal') {
    const { guild, ctx, actorName } = await resolveInteractionContext(interaction);

    const title = interaction.fields.getTextInputValue('task_title').trim();
    const description = interaction.fields.getTextInputValue('task_description').trim();
    const projectCategory = interaction.fields.getTextInputValue('task_category').trim() || 'General';
    const rawPriority = interaction.fields.getTextInputValue('task_priority');
    const rawDeadline = interaction.fields.getTextInputValue('task_deadline').trim();

    let priority: TaskPriority;
    try {
      priority = normalizePriority(rawPriority);
    } catch (err) {
      await interaction.reply({
        content: `❌ ${err instanceof Error ? err.message : 'Invalid priority.'}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let deadlineAt: Date | null = null;
    if (rawDeadline.length > 0) {
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content:
            '⛔ **Deadline Permission Denied:** Anyone can create tasks, but only the server owner or owner-authorised staff/roles can assign deadlines. Please resubmit with the Deadline field left empty.',
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

    const created = await createTask(
      {
        guildId: guild.id,
        title,
        description,
        projectCategory,
        priority,
        assigneeId: ctx.userId,
        deadlineAt,
        timezone: env.DEFAULT_TIMEZONE,
        actorName,
      },
      ctx
    );

    // Post the public interactive Task Card in the current channel so staff can track & complete it
    let postedChannelId: string | null = null;
    let postedMessageId: string | null = null;
    if (interaction.channel && 'send' in interaction.channel) {
      try {
        const msg = await interaction.channel.send({
          embeds: [buildTaskCardEmbed(created)],
          components: buildTaskCardComponents(created),
        });
        postedChannelId = msg.channelId;
        postedMessageId = msg.id;
        await attachDiscordMessageRef(created.id, msg.channelId, msg.id);
      } catch {
        // Fallback silently if bot cannot post directly in channel
      }
    }

    const userSelect = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`task:assign_select:${created.id}`)
        .setPlaceholder('Assign this goal to any server member (currently assigned to you)...')
        .setMinValues(1)
        .setMaxValues(1)
    );

    await interaction.reply({
      content: `✅ Created **Task #${created.id}: ${created.title}**! Select a staff member below if you want to assign it to someone else${postedMessageId ? ' (posted in channel)' : ''}:`,
      embeds: postedMessageId ? [] : [buildTaskCardEmbed(created)],
      components: postedMessageId ? [userSelect] : [userSelect, ...buildTaskCardComponents(created)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parts[0] === 'modal' && parts[1] === 'edit_task') {
    const taskId = Number(parts[2]);
    const { ctx, actorName } = await resolveInteractionContext(interaction);

    const title = interaction.fields.getTextInputValue('task_title').trim();
    const description = interaction.fields.getTextInputValue('task_description').trim();
    const projectCategory = interaction.fields.getTextInputValue('task_category').trim() || 'General';
    const rawPriority = interaction.fields.getTextInputValue('task_priority');
    const rawDeadline = interaction.fields.getTextInputValue('task_deadline').trim();

    let priority: TaskPriority;
    try {
      priority = normalizePriority(rawPriority);
    } catch (err) {
      await interaction.reply({
        content: `❌ ${err instanceof Error ? err.message : 'Invalid priority.'}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let deadlineAt: Date | undefined;
    let clearDeadline = false;
    if (rawDeadline.toLowerCase() === 'clear' || rawDeadline.toLowerCase() === 'none') {
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content: '⛔ You are not authorised to remove deadlines.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      clearDeadline = true;
    } else if (rawDeadline.length > 0) {
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content: '⛔ You are not authorised to set or modify deadlines.',
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

    try {
      const updated = await updateTask(
        taskId,
        {
          title,
          description,
          projectCategory,
          priority,
          deadlineAt,
          clearDeadline,
          actorName,
        },
        ctx
      );

      // Update linked channel message if triggered from message
      if (interaction.message) {
        await interaction.message
          .edit({
            embeds: [buildTaskCardEmbed(updated)],
            components: buildTaskCardComponents(updated),
          })
          .catch(() => null);
      }

      await interaction.reply({
        content: `✅ Updated **Task #${updated.id}**.`,
        embeds: [buildTaskCardEmbed(updated)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await interaction.reply({
        content: `⛔ ${err instanceof Error ? err.message : 'Failed to update task.'}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleUserSelectInteraction(
  interaction: UserSelectMenuInteraction
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts[0] === 'task' && parts[1] === 'assign_select') {
    const taskId = Number(parts[2]);
    const targetUser = interaction.users.first();
    if (!targetUser) return;

    const { guild, ctx, actorName } = await resolveInteractionContext(interaction);
    await syncTargetMember(guild, targetUser);

    try {
      const updated = await updateTask(
        taskId,
        { assigneeId: targetUser.id, actorName },
        ctx
      );

      // Refresh the posted channel embed if it exists
      if (updated.discordChannelId && updated.discordMessageId) {
        const channel = await guild.channels.fetch(updated.discordChannelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const msg = await channel.messages.fetch(updated.discordMessageId).catch(() => null);
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

      await interaction.update({
        content: `✅ Assigned **Task #${updated.id}: ${updated.title}** to <@${targetUser.id}>!`,
        components: [],
      });
    } catch (err) {
      await interaction.reply({
        content: `⛔ ${err instanceof Error ? err.message : 'Could not reassign task.'}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleStringSelectInteraction(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (interaction.customId === 'task:quick_select') {
    const taskId = Number(interaction.values[0]);
    const { guild } = await resolveInteractionContext(interaction);
    const task = await getTaskById(taskId, guild.id);
    if (!task) {
      await interaction.reply({
        content: `❌ Task #${taskId} not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [buildTaskCardEmbed(task)],
      components: buildTaskCardComponents(task),
      flags: MessageFlags.Ephemeral,
    });
  }
}
