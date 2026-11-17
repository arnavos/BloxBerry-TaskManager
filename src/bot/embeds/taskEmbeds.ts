import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { TaskView } from '../../services/taskService.js';

export const BRAND_COLOR = 0x7c3aed; // Bloxberry Violet
export const SUCCESS_COLOR = 0x10b981;
export const WARNING_COLOR = 0xf59e0b;
export const DANGER_COLOR = 0xef4444;
export const INFO_COLOR = 0x3b82f6;

export function statusEmoji(status: string): string {
  switch (status) {
    case 'Completed':
      return '✅';
    case 'Overdue':
      return '🚨';
    case 'In Progress':
      return '🔄';
    case 'On Hold':
      return '⏸️';
    default:
      return '⬜';
  }
}

export function priorityEmoji(priority: string): string {
  switch (priority) {
    case 'Urgent':
      return '🔴';
    case 'High':
      return '🟠';
    case 'Medium':
      return '🟡';
    default:
      return '🟢';
  }
}

export function taskEmbedColor(task: Pick<TaskView, 'status' | 'priority'>): number {
  if (task.status === 'Completed') return SUCCESS_COLOR;
  if (task.status === 'Overdue') return DANGER_COLOR;
  if (task.priority === 'Urgent') return DANGER_COLOR;
  if (task.priority === 'High') return WARNING_COLOR;
  if (task.status === 'In Progress') return INFO_COLOR;
  return BRAND_COLOR;
}

export function buildChecklistHubEmbed(guildName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🍓 Bloxberry Labs — Task & Checklist Hub')
    .setDescription(
      [
        `Welcome to the **${guildName}** internal task and goal tracker.`,
        '',
        '• **➕ Add Goal** — Create a new checklist item or task and assign it to any staff member.',
        '• **📋 View Checklists** — Browse active and completed server tasks.',
        '• **👤 My Tasks** — View and complete tasks assigned to you.',
        '• **📊 Task Overview** — Inspect deadlines, overdue alerts, and team workloads.',
      ].join('\n')
    )
    .setFooter({ text: 'Deadlines require owner-authorised permission • Default TZ: Asia/Kolkata' })
    .setTimestamp();
}

export function buildChecklistHubComponents(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('checklist:add_goal')
      .setLabel('Add Goal')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('checklist:view_all:1')
      .setLabel('View Checklists')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('checklist:my_tasks:1')
      .setLabel('My Tasks')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('checklist:overview')
      .setLabel('Task Overview')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Success)
  );
}

export function buildTaskCardEmbed(task: TaskView): EmbedBuilder {
  const isCompleted = task.status === 'Completed';
  const titlePrefix = isCompleted ? `✅ ~~#${task.id}: ${task.title}~~` : `${statusEmoji(task.status)} #${task.id}: ${task.title}`;

  const embed = new EmbedBuilder()
    .setColor(taskEmbedColor(task))
    .setTitle(titlePrefix.slice(0, 256))
    .setDescription(task.description ? task.description.slice(0, 2000) : '*No description provided.*')
    .addFields(
      { name: 'Status', value: `${statusEmoji(task.status)} **${task.status}**`, inline: true },
      { name: 'Priority', value: `${priorityEmoji(task.priority)} ${task.priority}`, inline: true },
      { name: 'Category', value: `\`${task.projectCategory}\``, inline: true },
      {
        name: 'Assigned To',
        value: task.assigneeId ? `<@${task.assigneeId}>` : 'Unassigned',
        inline: true,
      },
      { name: 'Created By', value: `<@${task.creatorId}>`, inline: true },
      { name: 'Countdown', value: `⏱️ **${task.countdown.label}**`, inline: true }
    )
    .setTimestamp(task.updatedAt);

  if (task.deadlineFormatted) {
    embed.addFields({
      name: 'Deadline (IST)',
      value: `📅 ${task.deadlineFormatted}`,
      inline: true,
    });
  }

  if (task.milestoneTitle) {
    embed.addFields({
      name: 'Roadmap Milestone',
      value: `🗺️ ${task.milestoneTitle}`,
      inline: true,
    });
  }

  if (isCompleted && task.completedAt) {
    embed.addFields({
      name: 'Completion Record',
      value: `Completed by ${task.completedById ? `<@${task.completedById}>` : 'Unknown'} on <t:${Math.floor(task.completedAt.getTime() / 1000)}:f>`,
      inline: false,
    });
  }

  if (task.dmDeliveryFailed) {
    embed.addFields({
      name: '⚠️ DM Delivery Warning',
      value: `Unable to DM assignee (${task.dmFailureReason ?? 'DMs disabled'}). Visible in server task overviews.`,
      inline: false,
    });
  }

  embed.setFooter({ text: `Task ID #${task.id} • Bloxberry Labs PM` });
  return embed;
}

export function buildTaskCardComponents(task: TaskView): ActionRowBuilder<ButtonBuilder>[] {
  const isCompleted = task.status === 'Completed';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:complete:${task.id}`)
      .setLabel(isCompleted ? 'Completed' : 'Mark Completed')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isCompleted),
    new ButtonBuilder()
      .setCustomId(`task:status:${task.id}:In Progress`)
      .setLabel('In Progress')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isCompleted || task.status === 'In Progress'),
    new ButtonBuilder()
      .setCustomId(`task:status:${task.id}:On Hold`)
      .setLabel('On Hold')
      .setEmoji('⏸️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isCompleted || task.status === 'On Hold'),
    new ButtonBuilder()
      .setCustomId(`task:edit_modal:${task.id}`)
      .setLabel('Edit')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`task:delete:${task.id}`)
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  return [row];
}

export function buildPaginatedTaskListEmbed(params: {
  title: string;
  tasks: TaskView[];
  page: number;
  pageSize?: number;
  emptyMessage?: string;
  color?: number;
}): {
  embed: EmbedBuilder;
  totalPages: number;
  currentPage: number;
  pageTasks: TaskView[];
} {
  const pageSize = params.pageSize ?? 6;
  const totalPages = Math.max(1, Math.ceil(params.tasks.length / pageSize));
  const currentPage = Math.min(Math.max(1, params.page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageTasks = params.tasks.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setColor(params.color ?? BRAND_COLOR)
    .setTitle(params.title)
    .setFooter({
      text: `Page ${currentPage}/${totalPages} • ${params.tasks.length} total task(s) • Bloxberry Labs`,
    })
    .setTimestamp();

  if (pageTasks.length === 0) {
    embed.setDescription(params.emptyMessage ?? 'No tasks match this view.');
    return { embed, totalPages, currentPage, pageTasks };
  }

  const lines = pageTasks.map((t) => {
    const titleFmt = t.status === 'Completed' ? `~~${t.title}~~` : `**${t.title}**`;
    const assignee = t.assigneeId ? `<@${t.assigneeId}>` : 'Unassigned';
    return [
      `${statusEmoji(t.status)} \`#${t.id}\` ${titleFmt} (${priorityEmoji(t.priority)} ${t.priority})`,
      `└ **${t.status}** • 👤 ${assignee} • 📁 \`${t.projectCategory}\` • ⏱️ ${t.countdown.label}`,
    ].join('\n');
  });

  embed.setDescription(lines.join('\n\n'));
  return { embed, totalPages, currentPage, pageTasks };
}

export function buildPaginationComponents(params: {
  prefix: string;
  page: number;
  totalPages: number;
  pageTasks?: TaskView[];
}): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (params.pageTasks && params.pageTasks.length > 0) {
    const pendingOnPage = params.pageTasks.filter((t) => t.status !== 'Completed');
    if (pendingOnPage.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('task:quick_select')
        .setPlaceholder('Inspect or complete a task from this page...')
        .addOptions(
          params.pageTasks.slice(0, 25).map((t) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`#${t.id}: ${t.title}`.slice(0, 100))
              .setDescription(`${t.status} • ${t.priority} • ${t.countdown.label}`.slice(0, 100))
              .setValue(String(t.id))
              .setEmoji(statusEmoji(t.status))
          )
        );
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
  }

  if (params.totalPages > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${params.prefix}:${params.page - 1}`)
          .setLabel('◀ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(params.page <= 1),
        new ButtonBuilder()
          .setCustomId(`${params.prefix}:${params.page + 1}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(params.page >= params.totalPages)
      )
    );
  }

  return rows;
}
