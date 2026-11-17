import {
  EmbedBuilder,
  type Message,
} from 'discord.js';
import { getEnv } from '../config/env.js';
import { parseDeadlineInput } from '../domain/countdown.js';
import {
  canManageDeadlines,
  canViewStaffTasks,
  isGuildOwner,
} from '../domain/permissions.js';
import {
  TASK_PRIORITIES,
  type TaskPriority,
} from '../domain/types.js';
import {
  buildPermissionContext,
  grantDeadlinePermission,
  listDeadlinePermissions,
  revokeDeadlinePermission,
} from '../services/permissionService.js';
import {
  createProject,
  listProjectsWithRoadmaps,
} from '../services/roadmapService.js';
import {
  completeTask,
  createTask,
  deleteTask,
  getOrganizedTasksOverview,
  getTaskById,
  getTaskHistory,
  listTasks,
  updateTask,
} from '../services/taskService.js';
import {
  buildChecklistHubComponents,
  buildChecklistHubEmbed,
  buildPaginatedTaskListEmbed,
  buildPaginationComponents,
  buildTaskCardComponents,
  buildTaskCardEmbed,
  INFO_COLOR,
  SUCCESS_COLOR,
} from './embeds/taskEmbeds.js';
import {
  buildRoadmapEmbed,
} from './embeds/roadmapEmbeds.js';
import { buildOverviewEmbedForGuild } from './interactions/checklistHandlers.js';
import {
  buildY2kHomePanel,
  buildY2kTasksPanel,
  buildY2kRoadmapPanel,
  buildY2kSettingsPanel,
} from './embeds/y2kPanels.js';

export const BOT_PREFIX = ';';

// Command Aliases / Short-forms mapping
export const COMMAND_ALIASES: Record<string, string> = {
  // Main Control Centre
  'bloxpilot': 'bloxpilot',
  'bp': 'bloxpilot',
  'control': 'bloxpilot',
  'dash': 'bloxpilot',
  'hub': 'bloxpilot',

  // Checklist & Tasks
  'cl': 'checklist',
  'checklist': 'checklist',
  'add': 'add-task',
  'addtask': 'add-task',
  'add-task': 'add-task',
  'tasks': 'tasks',
  't': 'tasks',
  'mytasks': 'my-tasks',
  'my-tasks': 'my-tasks',
  'mt': 'my-tasks',
  'stafftasks': 'staff-tasks',
  'staff-tasks': 'staff-tasks',
  'st': 'staff-tasks',
  'task': 'task-details',
  'task-details': 'task-details',
  'td': 'task-details',
  'task-complete': 'task-complete',
  'complete': 'task-complete',
  'done': 'task-complete',
  'task-edit': 'task-edit',
  'edit': 'task-edit',
  'task-delete': 'task-delete',
  'delete': 'task-delete',
  'del': 'task-delete',

  // Deadlines
  'deadline-set': 'deadline-set',
  'dl-set': 'deadline-set',
  'setdl': 'deadline-set',
  'deadline-edit': 'deadline-edit',
  'dl-edit': 'deadline-edit',
  'deadline-remove': 'deadline-remove',
  'dl-remove': 'deadline-remove',
  'removedl': 'deadline-remove',
  'deadline-permissions': 'deadline-permissions',
  'dl-perms': 'deadline-permissions',
  'perms': 'deadline-permissions',
  'deadline-authorise': 'deadline-authorise',
  'dl-auth': 'deadline-authorise',
  'authorise': 'deadline-authorise',
  'auth': 'deadline-authorise',
  'deadline-revoke': 'deadline-revoke',
  'dl-revoke': 'deadline-revoke',
  'revoke': 'deadline-revoke',

  // Roadmap
  'roadmap': 'roadmap',
  'rm': 'roadmap',
  'roadmap-progress': 'roadmap-progress',
  'rm-progress': 'roadmap-progress',
  'rm-view': 'roadmap-view',
  'roadmap-view': 'roadmap-view',
  'roadmap-create': 'roadmap-create',
  'rm-create': 'roadmap-create',
  'roadmap-update': 'roadmap-update',
  'rm-update': 'roadmap-update',

  // System
  'management-panel': 'management-panel',
  'panel': 'management-panel',
  'mp': 'management-panel',
  'bot-status': 'bot-status',
  'status': 'bot-status',
  'help': 'help',
  'h': 'help',
};

/**
 * Parses space-separated tokens with quotes support (e.g. `add-task "Title here" @User "Category"`)
 */
export function parseArgs(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

export async function handlePrefixMessage(message: Message): Promise<void> {
  // Ignore bots and DM messages
  if (message.author.bot || !message.guild || !message.member) return;

  const content = message.content.trim();
  if (!content) return;

  const guild = message.guild;
  const member = message.member;

  // Build permission context to know if member is authorised
  const roleIds = member.roles?.cache
    ? [...member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => r.id)
    : [];
  const ctx = await buildPermissionContext({
    guildId: guild.id,
    userId: message.author.id,
    roleIds,
    guildOwnerId: guild.ownerId,
  });

  const isAuthorised = canManageDeadlines(ctx);
  const startsWithPrefix = content.startsWith(BOT_PREFIX);

  // If message doesn't start with ';' AND user is not authorised, ignore
  if (!startsWithPrefix && !isAuthorised) {
    return;
  }

  // Strip prefix if present, else take full trimmed text (for authorised no-prefix invocation)
  const commandBody = startsWithPrefix ? content.slice(BOT_PREFIX.length).trim() : content;
  if (!commandBody) return;

  const args = parseArgs(commandBody);
  if (args.length === 0) return;

  const rawCmd = args[0].toLowerCase();
  const canonicalCommand = COMMAND_ALIASES[rawCmd];

  // If no prefix was used, only respond if the first word is a known bot command alias!
  // This avoids accidental triggers when authorised members talk normally in chat.
  if (!startsWithPrefix && !canonicalCommand) {
    return;
  }

  if (!canonicalCommand) {
    if (startsWithPrefix) {
      await message.reply({
        content: `❌ Unknown command \`${rawCmd}\`. Type \`;help\` or \`/help\` to view all commands.`,
      });
    }
    return;
  }

  const actorName = member.displayName ?? message.author.username;
  const cmdArgs = args.slice(1);

  try {
    await executeTextCommand(canonicalCommand, cmdArgs, message, ctx, actorName);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error executing command';
    await message.reply({
      content: `⚠️ **Error**: ${errorMsg}`,
    });
  }
}

async function executeTextCommand(
  cmd: string,
  args: string[],
  message: Message,
  ctx: ReturnType<typeof buildPermissionContext> extends Promise<infer T> ? T : never,
  actorName: string
): Promise<void> {
  const guild = message.guild!;
  const env = getEnv();

  switch (cmd) {
    case 'bloxpilot': {
      const tasks = await listTasks({ guildId: guild.id });
      const roadmaps = await listProjectsWithRoadmaps(guild.id);
      const panel = buildY2kHomePanel({
        guildId: guild.id,
        userName: actorName,
        project: roadmaps[0] ?? null,
        tasks,
      });
      await message.reply({ embeds: [panel.embed], components: panel.components });
      break;
    }

    case 'help': {
      const tasks = await listTasks({ guildId: guild.id });
      const roadmaps = await listProjectsWithRoadmaps(guild.id);
      const panel = buildY2kHomePanel({
        guildId: guild.id,
        userName: actorName,
        project: roadmaps[0] ?? null,
        tasks,
      });
      await message.reply({
        content: '✦ **Welcome to BloxPilot Control Centre**. Use the interactive buttons and menus below to navigate your workspace.',
        embeds: [panel.embed],
        components: panel.components,
      });
      break;
    }

    case 'checklist': {
      const tasks = await listTasks({ guildId: guild.id });
      const panel = buildY2kTasksPanel({
        guildId: guild.id,
        tasks,
        activeFilter: 'all',
        page: 1,
      });
      await message.reply({ embeds: [panel.embed], components: panel.components });
      break;
    }

    case 'add-task': {
      if (args.length === 0) {
        await message.reply({
          content: '❌ Usage: `;add-task <title> [@assignee] [category] [priority]`\nExample: `;add "Combat Animations" @alice "Art/VFX" High`',
        });
        return;
      }
      const title = args[0];
      let assigneeId = ctx.userId;
      const mention = message.mentions.users.first();
      if (mention) {
        assigneeId = mention.id;
      } else if (args[1] && /^\d+$/.test(args[1])) {
        assigneeId = args[1];
      }

      const projectCategory = args[2] ?? 'General';
      let priority: TaskPriority = 'Medium';
      if (args[3]) {
        const found = TASK_PRIORITIES.find((p) => p.toLowerCase() === args[3].toLowerCase());
        if (found) priority = found;
      }

      const task = await createTask(
        {
          guildId: guild.id,
          title,
          assigneeId,
          projectCategory,
          priority,
          actorName,
        },
        ctx
      );

      const embed = buildTaskCardEmbed(task);
      const components = buildTaskCardComponents(task);
      await message.reply({
        content: `✅ Task **#${task.id}** created successfully!`,
        embeds: [embed],
        components,
      });
      break;
    }

    case 'tasks': {
      const mode = (args[0] ?? 'overview').toLowerCase();
      if (mode === 'overview') {
        const embed = await buildOverviewEmbedForGuild(guild.id);
        await message.reply({ embeds: [embed] });
        return;
      }

      const statusFilter =
        mode === 'completed'
          ? 'Completed'
          : mode === 'in_progress'
            ? 'In Progress'
            : mode === 'overdue'
              ? 'Overdue'
              : mode === 'due_today' || mode === 'today'
                ? 'due_today'
                : mode === 'upcoming'
                  ? 'upcoming'
                  : undefined;

      const all = await listTasks({ guildId: guild.id });
      let filtered = all;
      let title = `📊 Bloxberry Labs Tasks — ${mode}`;

      if (statusFilter === 'due_today') {
        const overview = await getOrganizedTasksOverview(guild.id, env.DEFAULT_TIMEZONE);
        filtered = overview.dueToday;
        title = '📅 Tasks Due Today';
      } else if (statusFilter === 'upcoming') {
        const overview = await getOrganizedTasksOverview(guild.id, env.DEFAULT_TIMEZONE);
        filtered = overview.upcomingDeadlines;
        title = '⏰ Upcoming Deadlines';
      } else if (statusFilter) {
        filtered = all.filter((t) => t.status === statusFilter);
      }

      const paginated = buildPaginatedTaskListEmbed({
        title,
        tasks: filtered,
        page: 1,
      });
      const components = buildPaginationComponents({
        prefix: 'tasks:all',
        page: 1,
        totalPages: paginated.totalPages,
        pageTasks: paginated.pageTasks,
      });
      await message.reply({ embeds: [paginated.embed], components });
      break;
    }

    case 'my-tasks': {
      const all = await listTasks({ guildId: guild.id, assigneeId: ctx.userId });
      const paginated = buildPaginatedTaskListEmbed({
        title: `👤 My Tasks — ${actorName} (${all.length})`,
        tasks: all,
        page: 1,
      });
      const components = buildPaginationComponents({
        prefix: 'mytasks:all',
        page: 1,
        totalPages: paginated.totalPages,
        pageTasks: paginated.pageTasks,
      });
      await message.reply({ embeds: [paginated.embed], components });
      break;
    }

    case 'staff-tasks': {
      const targetUser = message.mentions.users.first();
      const targetId = targetUser?.id ?? args[0];
      if (!targetId) {
        await message.reply({ content: '❌ Usage: `;staff-tasks @user`' });
        return;
      }

      if (!canViewStaffTasks(ctx, targetId)) {
        await message.reply({
          content: '❌ You can only view your own tasks. Only authorised management members can inspect other staff tasks.',
        });
        return;
      }

      const staffTasks = await listTasks({ guildId: guild.id, assigneeId: targetId });
      const targetName = targetUser?.displayName ?? targetUser?.username ?? targetId;
      const paginated = buildPaginatedTaskListEmbed({
        title: `👤 Staff Tasks — ${targetName} (${staffTasks.length})`,
        tasks: staffTasks,
        page: 1,
      });
      await message.reply({ embeds: [paginated.embed] });
      break;
    }

    case 'task-details': {
      const taskId = Number(args[0]);
      if (isNaN(taskId)) {
        await message.reply({ content: '❌ Usage: `;task-details <taskId>` (e.g. `;task 1`)' });
        return;
      }

      const task = await getTaskById(taskId, guild.id);
      if (!task) {
        await message.reply({ content: `❌ Task #${taskId} was not found.` });
        return;
      }

      const history = await getTaskHistory(taskId, guild.id);
      const embed = buildTaskCardEmbed(task);
      if (history.length > 0) {
        const historyText = history
          .slice(0, 5)
          .map((h) => `• **${h.action}** by ${h.actorName} (<t:${Math.floor(new Date(h.createdAt).getTime() / 1000)}:R>)`)
          .join('\n');
        embed.addFields({ name: 'Recent History', value: historyText });
      }

      const components = buildTaskCardComponents(task);
      await message.reply({ embeds: [embed], components });
      break;
    }

    case 'task-complete': {
      const taskId = Number(args[0]);
      if (isNaN(taskId)) {
        await message.reply({ content: '❌ Usage: `;task-complete <taskId>` (e.g. `;complete 1`)' });
        return;
      }

      const completed = await completeTask(taskId, ctx, actorName);
      const embed = buildTaskCardEmbed(completed);
      const components = buildTaskCardComponents(completed);
      await message.reply({
        content: `🎉 Task **#${completed.id}** marked as **Completed**!`,
        embeds: [embed],
        components,
      });
      break;
    }

    case 'task-delete': {
      const taskId = Number(args[0]);
      if (isNaN(taskId)) {
        await message.reply({ content: '❌ Usage: `;task-delete <taskId>`' });
        return;
      }

      const res = await deleteTask(taskId, ctx, actorName);
      await message.reply({ content: `🗑️ Task **#${taskId}** ("${res.title}") has been deleted.` });
      break;
    }

    case 'deadline-set': {
      const taskId = Number(args[0]);
      const deadlineStr = args.slice(1).join(' ');
      if (isNaN(taskId) || !deadlineStr) {
        await message.reply({
          content: '❌ Usage: `;deadline-set <taskId> <deadline>`\nExample: `;deadline-set 1 2026-11-20 18:00` or `;setdl 1 tomorrow 6pm`',
        });
        return;
      }

      let parsedDate: Date;
      try {
        const parsed = parseDeadlineInput(deadlineStr, env.DEFAULT_TIMEZONE);
        parsedDate = parsed.date;
      } catch (err) {
        await message.reply({
          content: `❌ Could not parse deadline: "${deadlineStr}". Format as \`YYYY-MM-DD HH:mm\` or \`tomorrow 6pm\`.`,
        });
        return;
      }

      const updated = await updateTask(taskId, { deadlineAt: parsedDate, actorName }, ctx);
      const embed = buildTaskCardEmbed(updated);
      await message.reply({
        content: `⏰ Deadline updated for Task **#${updated.id}** to **${updated.deadlineFormatted}**`,
        embeds: [embed],
      });
      break;
    }

    case 'deadline-remove': {
      const taskId = Number(args[0]);
      if (isNaN(taskId)) {
        await message.reply({ content: '❌ Usage: `;deadline-remove <taskId>`' });
        return;
      }

      const updated = await updateTask(taskId, { clearDeadline: true, actorName }, ctx);
      await message.reply({ content: `✅ Deadline removed from Task **#${updated.id}**.` });
      break;
    }

    case 'deadline-permissions': {
      const perms = await listDeadlinePermissions(guild.id);
      const embed = new EmbedBuilder()
        .setColor(INFO_COLOR)
        .setTitle('🛡️ Bloxberry Labs — Deadline Permissions')
        .setDescription(
          `Only the server owner (<@${guild.ownerId}>) and authorised staff/roles can set or edit deadlines.`
        )
        .addFields(
          {
            name: '👑 Server Owner',
            value: perms.guildOwner
              ? `• <@${perms.guildOwner.id}> (\`${perms.guildOwner.displayName}\`)`
              : `<@${guild.ownerId}>`,
            inline: false,
          },
          {
            name: `👤 Authorised Users (${perms.authorisedUsers.length})`,
            value:
              perms.authorisedUsers.length > 0
                ? perms.authorisedUsers.map((u) => `• <@${u.userId}> (\`${u.displayName}\`)`).join('\n')
                : '*No individual users authorised yet.*',
            inline: false,
          },
          {
            name: `🎭 Authorised Roles (${perms.authorisedRoles.length})`,
            value:
              perms.authorisedRoles.length > 0
                ? perms.authorisedRoles.map((r) => `• <@&${r.roleId}> (\`${r.roleName}\`)`).join('\n')
                : '*No roles authorised yet.*',
            inline: false,
          }
        )
        .setFooter({ text: 'Use ;deadline-authorise to grant permissions (Server Owner only)' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      break;
    }

    case 'deadline-authorise': {
      if (!isGuildOwner(ctx)) {
        await message.reply({ content: '❌ Only the actual Discord server owner can authorise deadline permissions.' });
        return;
      }

      const sub = (args[0] ?? '').toLowerCase();
      if (sub === 'user') {
        const user = message.mentions.users.first();
        const userId = user?.id ?? args[1];
        if (!userId) {
          await message.reply({ content: '❌ Usage: `;deadline-authorise user @user`' });
          return;
        }
        const label = user?.displayName ?? user?.username ?? userId;
        const res = await grantDeadlinePermission({
          guildId: guild.id,
          targetType: 'user',
          targetId: userId,
          targetLabel: label,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await message.reply({
          content: res.alreadyActive
            ? `ℹ️ <@${userId}> is already authorised to manage deadlines.`
            : `✅ Successfully authorised <@${userId}> to assign and manage task deadlines.`,
        });
      } else if (sub === 'role') {
        const role = message.mentions.roles.first();
        const roleId = role?.id ?? args[1];
        if (!roleId) {
          await message.reply({ content: '❌ Usage: `;deadline-authorise role @role`' });
          return;
        }
        const label = role?.name ?? roleId;
        const res = await grantDeadlinePermission({
          guildId: guild.id,
          targetType: 'role',
          targetId: roleId,
          targetLabel: label,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await message.reply({
          content: res.alreadyActive
            ? `ℹ️ Role <@&${roleId}> is already authorised to manage deadlines.`
            : `✅ Successfully authorised role <@&${roleId}> to assign and manage task deadlines.`,
        });
      } else {
        await message.reply({
          content: '❌ Usage:\n`;deadline-authorise user @user`\n`;deadline-authorise role @role`',
        });
      }
      break;
    }

    case 'deadline-revoke': {
      if (!isGuildOwner(ctx)) {
        await message.reply({ content: '❌ Only the actual Discord server owner can revoke deadline permissions.' });
        return;
      }

      const sub = (args[0] ?? '').toLowerCase();
      if (sub === 'user') {
        const user = message.mentions.users.first();
        const userId = user?.id ?? args[1];
        if (!userId) {
          await message.reply({ content: '❌ Usage: `;deadline-revoke user @user`' });
          return;
        }
        const res = await revokeDeadlinePermission({
          guildId: guild.id,
          targetType: 'user',
          targetId: userId,
          targetLabel: user?.displayName ?? userId,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await message.reply({
          content: res.revoked
            ? `✅ Revoked deadline permissions from <@${userId}>.`
            : `ℹ️ <@${userId}> was not in the active authorisation list.`,
        });
      } else if (sub === 'role') {
        const role = message.mentions.roles.first();
        const roleId = role?.id ?? args[1];
        if (!roleId) {
          await message.reply({ content: '❌ Usage: `;deadline-revoke role @role`' });
          return;
        }
        const res = await revokeDeadlinePermission({
          guildId: guild.id,
          targetType: 'role',
          targetId: roleId,
          targetLabel: role?.name ?? roleId,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await message.reply({
          content: res.revoked
            ? `✅ Revoked deadline permissions from role <@&${roleId}>.`
            : `ℹ️ Role <@&${roleId}> was not in the active authorisation list.`,
        });
      } else {
        await message.reply({
          content: '❌ Usage:\n`;deadline-revoke user @user`\n`;deadline-revoke role @role`',
        });
      }
      break;
    }

    case 'roadmap': {
      const roadmaps = await listProjectsWithRoadmaps(guild.id);
      const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps });
      await message.reply({ embeds: [panel.embed], components: panel.components });
      break;
    }

    case 'roadmap-progress': {
      const roadmaps = await listProjectsWithRoadmaps(guild.id);
      if (roadmaps.length === 0) {
        await message.reply({ content: 'ℹ️ No roadmap projects found.' });
        return;
      }
      const project = roadmaps[0];
      const embed = buildRoadmapEmbed(project);
      await message.reply({ embeds: [embed] });
      break;
    }

    case 'roadmap-create': {
      const name = args.join(' ').trim();
      if (!name) {
        await message.reply({ content: '❌ Usage: `;roadmap-create <Project Name>`' });
        return;
      }
      const created = await createProject(
        { guildId: guild.id, name, seedDefaultStages: true, actorName },
        ctx
      );
      const embed = buildRoadmapEmbed(created);
      await message.reply({
        content: `🎉 Project roadmap **${created.name}** initialized with 12 Roblox development stages!`,
        embeds: [embed],
      });
      break;
    }

    case 'management-panel': {
      const perms = await listDeadlinePermissions(guild.id);
      const panel = buildY2kSettingsPanel({
        guildId: guild.id,
        isOwner: isGuildOwner(ctx),
        canManage: canManageDeadlines(ctx),
        authorisedUsers: perms.authorisedUsers,
        authorisedRoles: perms.authorisedRoles,
      });
      await message.reply({ embeds: [panel.embed], components: panel.components });
      break;
    }

    case 'bot-status': {
      const tasks = await listTasks({ guildId: guild.id });
      const overdue = tasks.filter((t) => t.status === 'Overdue').length;
      const completed = tasks.filter((t) => t.status === 'Completed').length;
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const secs = uptimeSec % 60;

      const embed = new EmbedBuilder()
        .setColor(SUCCESS_COLOR)
        .setTitle('🩺 Bloxberry Labs PM Bot — Status')
        .addFields(
          { name: 'Gateway Ping', value: `${message.client.ws.ping} ms`, inline: true },
          { name: 'Storage Engine', value: '✅ Discord Channel (`#bloxpilot-storage`)', inline: true },
          { name: 'Process Uptime', value: `${hours}h ${mins}m ${secs}s`, inline: true },
          { name: 'Tasks Tracked', value: `${tasks.length} (${overdue} overdue, ${completed} completed)`, inline: true },
          { name: 'Prefix', value: `\`${BOT_PREFIX}\` or No-Prefix (Authorised)`, inline: true },
          { name: 'Timezone', value: env.DEFAULT_TIMEZONE, inline: true }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      break;
    }
  }
}
