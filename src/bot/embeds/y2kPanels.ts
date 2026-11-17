import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  type AnyComponentBuilder,
} from 'discord.js';
import {
  createY2kEmbed,
  renderY2kProgressBar,
  Y2K_COLORS,
  Y2K_ICONS,
} from '../../domain/y2kTheme.js';
import { getGuildConfig } from '../../services/configService.js';
import type { TaskView } from '../../services/taskService.js';
import type { ProjectRoadmapView, MilestoneView } from '../../services/roadmapService.js';
import type { AuthorisedUserView, AuthorisedRoleView } from '../../services/permissionService.js';
import { formatInTimezone } from '../../domain/countdown.js';

// Navigation Bar
export function buildY2kNavBar(activeTab: 'home' | 'tasks' | 'roadmap' | 'team' | 'settings'): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nav:home')
      .setLabel('Home')
      .setEmoji('🏠')
      .setStyle(activeTab === 'home' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nav:tasks')
      .setLabel('Tasks')
      .setEmoji('📋')
      .setStyle(activeTab === 'tasks' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nav:roadmap')
      .setLabel('Roadmap')
      .setEmoji('🗺️')
      .setStyle(activeTab === 'roadmap' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nav:team')
      .setLabel('Team')
      .setEmoji('👥')
      .setStyle(activeTab === 'team' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nav:settings')
      .setLabel('Settings')
      .setEmoji('⚙️')
      .setStyle(activeTab === 'settings' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

// 1. HOME PANEL
export function buildY2kHomePanel(params: {
  guildId: string;
  userName: string;
  project: ProjectRoadmapView | null;
  tasks: TaskView[];
}) {
  const config = getGuildConfig(params.guildId);
  const totalTasks = params.tasks.length;
  const completedTasks = params.tasks.filter((t) => t.status === 'Completed').length;
  const overdueTasks = params.tasks.filter((t) => t.status === 'Overdue').length;
  const inProgressTasks = params.tasks.filter((t) => t.status === 'In Progress').length;

  const currentProjectName = params.project?.name ?? 'No Active Project';
  const progressPercent = params.project?.progress?.overallPercent ?? 0;
  const progressBar = renderY2kProgressBar(progressPercent, 12);
  const currentMilestone = params.project?.progress?.currentMilestone;

  const embed = createY2kEmbed({
    color: config.embedColor,
    title: `◈ ${config.workspaceName.toUpperCase()} — CONTROL CENTRE`,
    subtitle: [
      `✦ Welcome back, **${params.userName}**. Your workspace is ready.`,
      `*${config.welcomeMessage}*`,
      '',
      `**Active Project:** \`${currentProjectName}\``,
      `**Progression:** \`${progressBar}\``,
      currentMilestone ? `**Current Milestone:** \`#${currentMilestone.sortOrder}\` **${currentMilestone.title}** (${currentMilestone.status})` : `*No milestones active.*`,
    ].join('\n'),
    footerText: config.footerText,
  });

  embed.addFields(
    {
      name: '📊 Sprint Metrics',
      value: [
        `• Active Tasks: **${totalTasks - completedTasks}**`,
        `• In Progress: **${inProgressTasks}**`,
        `• Overdue: **${overdueTasks}**`,
        `• Completed: **${completedTasks}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '⚡ Quick Shortcuts',
      value: [
        '`Tasks` — Checklists, filters & task creator',
        '`Roadmap` — Project & milestone progression',
        '`Team` — Staff workload & directory',
        '`Settings` — Branding, categories & permissions',
      ].join('\n'),
      inline: true,
    }
  );

  const navRow = buildY2kNavBar('home');
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('task:add_goal_modal')
      .setLabel('Add Goal')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('home:quick_tasks')
      .setLabel('View Tasks')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('home:quick_roadmap')
      .setLabel('Roadmap')
      .setEmoji('🗺️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [navRow, actionRow] };
}

// 2. TASKS PANEL
export function buildY2kTasksPanel(params: {
  guildId: string;
  tasks: TaskView[];
  activeFilter?: string;
  page?: number;
}) {
  const config = getGuildConfig(params.guildId);
  const filter = params.activeFilter ?? 'all';
  const page = params.page ?? 1;
  const pageSize = 5;

  let filtered = params.tasks;
  if (filter === 'overdue') filtered = filtered.filter((t) => t.status === 'Overdue');
  else if (filter === 'in_progress') filtered = filtered.filter((t) => t.status === 'In Progress');
  else if (filter === 'completed') filtered = filtered.filter((t) => t.status === 'Completed');
  else if (filter === 'pending') filtered = filtered.filter((t) => t.status !== 'Completed');

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageTasks = filtered.slice(start, start + pageSize);

  const embed = createY2kEmbed({
    color: config.embedColor,
    title: `📋 TASK WORKSPACE — [FILTER: ${filter.toUpperCase()}]`,
    subtitle: `Managing **${filtered.length}** task(s) on the board • Page ${currentPage} of ${totalPages}`,
    footerText: config.footerText,
  });

  if (pageTasks.length === 0) {
    embed.addFields({
      name: '✦ Workspace Clear',
      value: '*No tasks match this filter. Click "Add Goal" below to schedule one.*',
    });
  } else {
    for (const t of pageTasks) {
      const isDone = t.status === 'Completed';
      const titleFmt = isDone ? `~~#${t.id}: ${t.title}~~` : `**#${t.id}: ${t.title}**`;
      const assigneeFmt = t.assigneeId ? `<@${t.assigneeId}>` : '*Unassigned*';
      embed.addFields({
        name: `${isDone ? '✓' : '◈'} ${titleFmt}`,
        value: [
          `Status: **${t.status}** • Priority: \`${t.priority}\` • Category: \`${t.projectCategory}\``,
          `Assigned to: ${assigneeFmt} • Deadline: **${t.countdown.label}**`,
        ].join('\n'),
        inline: false,
      });
    }
  }

  const navRow = buildY2kNavBar('tasks');

  // Filter Dropdown
  const filterSelect = new StringSelectMenuBuilder()
    .setCustomId('tasks:filter_select')
    .setPlaceholder('Filter tasks by status...')
    .addOptions([
      { label: 'All Tasks', value: 'all', emoji: '📋', default: filter === 'all' },
      { label: 'Pending Only', value: 'pending', emoji: '⏳', default: filter === 'pending' },
      { label: 'In Progress', value: 'in_progress', emoji: '🚀', default: filter === 'in_progress' },
      { label: 'Overdue Alerts', value: 'overdue', emoji: '🚨', default: filter === 'overdue' },
      { label: 'Completed', value: 'completed', emoji: '✅', default: filter === 'completed' },
    ]);
  const filterRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(filterSelect);

  // Quick Action Buttons
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('task:add_goal_modal')
      .setLabel('Add Goal')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tasks:page:${currentPage - 1}:${filter}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`tasks:page:${currentPage + 1}:${filter}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages)
  );

  const components = [navRow, filterRow, actionRow];

  // If tasks exist on page, add task inspector dropdown
  if (pageTasks.length > 0) {
    const taskOptions = pageTasks.map((t) => ({
      label: `#${t.id}: ${t.title.slice(0, 50)}`,
      description: `${t.status} • Assigned: ${t.assigneeName.slice(0, 30)}`,
      value: `task_view:${t.id}`,
      emoji: t.status === 'Completed' ? '✅' : '🔹',
    }));
    const taskSelect = new StringSelectMenuBuilder()
      .setCustomId('tasks:inspect_task')
      .setPlaceholder('Select a task to inspect, edit or complete...')
      .addOptions(taskOptions);
    components.splice(2, 0, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(taskSelect));
  }

  return { embed, components };
}

// 3. TASK CARD VIEW (Detailed Single Task)
export function buildY2kTaskCard(task: TaskView, config = getGuildConfig(task.guildId)) {
  const isDone = task.status === 'Completed';
  const embed = createY2kEmbed({
    color: isDone ? Y2K_COLORS.SUCCESS_EMERALD : task.status === 'Overdue' ? Y2K_COLORS.DANGER_CRIMSON : config.embedColor,
    title: `${isDone ? '✓ SHIPPED' : '◈ TASK'}: #${task.id} — ${task.title}`,
    subtitle: task.description || '*No detailed specifications attached.*',
    footerText: config.footerText,
  });

  embed.addFields(
    { name: 'Status', value: `**${task.status}**`, inline: true },
    { name: 'Priority', value: `\`${task.priority}\``, inline: true },
    { name: 'Category', value: `\`${task.projectCategory}\``, inline: true },
    { name: 'Assigned Staff', value: task.assigneeId ? `<@${task.assigneeId}>` : '*Unassigned*', inline: true },
    { name: 'Creator', value: `<@${task.creatorId}>`, inline: true },
    { name: 'Deadline / Countdown', value: `⏱️ **${task.countdown.label}**`, inline: true }
  );

  if (task.deadlineFormatted) {
    embed.addFields({ name: 'Scheduled Date (IST)', value: `📅 ${task.deadlineFormatted}`, inline: true });
  }

  if (task.milestoneTitle) {
    embed.addFields({ name: 'Roadmap Link', value: `🗺️ ${task.milestoneTitle}`, inline: true });
  }

  const navRow = buildY2kNavBar('tasks');
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:toggle_complete:${task.id}`)
      .setLabel(isDone ? 'Reopen' : 'Mark Complete')
      .setEmoji(isDone ? '🔄' : '✅')
      .setStyle(isDone ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`task:start:${task.id}`)
      .setLabel('Start Task')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isDone || task.status === 'In Progress'),
    new ButtonBuilder()
      .setCustomId(`task:edit_modal:${task.id}`)
      .setLabel('Edit')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`task:reassign_menu:${task.id}`)
      .setLabel('Reassign')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary)
  );

  const moreRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:delete_confirm:${task.id}`)
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('task:back_to_list')
      .setLabel('Back to List')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [navRow, actionRow, moreRow] };
}

// 4. ROADMAP PANEL
export function buildY2kRoadmapPanel(params: {
  guildId: string;
  projects: ProjectRoadmapView[];
  activeProjectId?: number | null;
}) {
  const config = getGuildConfig(params.guildId);
  const activeProject =
    params.projects.find((p) => p.id === params.activeProjectId) ??
    params.projects[0] ??
    null;

  const embed = createY2kEmbed({
    color: config.embedColor,
    title: `🗺️ DEVELOPMENT ROADMAP — ${activeProject ? activeProject.name.toUpperCase() : 'NO PROJECT SELECTED'}`,
    subtitle: activeProject
      ? [
          activeProject.description || '*Bloxberry Labs production lifecycle.*',
          '',
          `**Overall Completion:** \`${renderY2kProgressBar(activeProject.progress.overallPercent, 14)}\``,
          `Completed: **${activeProject.progress.completedCount}/${activeProject.progress.totalMilestones}** • In Progress: **${activeProject.progress.inProgressCount}** • Blocked: **${activeProject.progress.blockedCount}**`,
        ].join('\n')
      : '*No roadmap projects found. Click "Create Project" to start one.*',
    footerText: config.footerText,
  });

  if (activeProject && activeProject.milestones.length > 0) {
    const stageLines = activeProject.milestones.slice(0, 15).map((m: MilestoneView) => {
      const ownerFmt = m.ownerId ? `<@${m.ownerId}>` : 'Unassigned';
      return `\`#${m.sortOrder}\` **${m.title}** [${m.status}] — **${m.progressPercent}%** (Owner: ${ownerFmt})`;
    });
    embed.addFields({
      name: '📍 Production Stages',
      value: stageLines.join('\n').slice(0, 1024),
    });
  }

  const navRow = buildY2kNavBar('roadmap');

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('roadmap:create_project_modal')
      .setLabel('Create Project')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(activeProject ? `roadmap:add_milestone_modal:${activeProject.id}` : 'roadmap:disabled')
      .setLabel('Add Milestone')
      .setEmoji('🚩')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!activeProject),
    new ButtonBuilder()
      .setCustomId(activeProject ? `roadmap:reorder_prompt:${activeProject.id}` : 'roadmap:disabled2')
      .setLabel('Reorder Stages')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!activeProject || activeProject.milestones.length <= 1)
  );

  const components: ActionRowBuilder<any>[] = [navRow, actionRow];

  // Dropdown to inspect or edit milestones
  if (activeProject && activeProject.milestones.length > 0) {
    const milestoneOptions = activeProject.milestones.map((m: MilestoneView) => ({
      label: `Stage ${m.sortOrder}: ${m.title.slice(0, 50)}`,
      description: `Status: ${m.status} • Progress: ${m.progressPercent}%`,
      value: `milestone_view:${m.id}`,
      emoji: m.status === 'Completed' ? '✅' : '🚩',
    }));
    const milestoneSelect = new StringSelectMenuBuilder()
      .setCustomId('roadmap:select_milestone')
      .setPlaceholder('Select a milestone to edit, reassign or delete...')
      .addOptions(milestoneOptions);
    components.splice(1, 0, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(milestoneSelect));
  }

  // Project selector if multiple projects exist
  if (params.projects.length > 1) {
    const projOptions = params.projects.map((p) => ({
      label: p.name.slice(0, 50),
      description: `${p.milestones.length} stages • ${p.progress.overallPercent}% completed`,
      value: `switch_project:${p.id}`,
      default: activeProject?.id === p.id,
      emoji: '📁',
    }));
    const projSelect = new StringSelectMenuBuilder()
      .setCustomId('roadmap:switch_project')
      .setPlaceholder('Switch active roadmap project...')
      .addOptions(projOptions);
    components.splice(1, 0, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(projSelect));
  }

  return { embed, components };
}

// 5. MILESTONE DETAIL & EDIT CARD
export function buildY2kMilestoneCard(milestone: MilestoneView, projectName: string) {
  const isDone = milestone.status === 'Completed';
  const embed = createY2kEmbed({
    color: isDone ? Y2K_COLORS.SUCCESS_EMERALD : Y2K_COLORS.CYBER_BLUE,
    title: `🚩 STAGE ${milestone.sortOrder}: ${milestone.title}`,
    subtitle: milestone.description || '*No description provided.*',
  });

  embed.addFields(
    { name: 'Project', value: `\`${projectName}\``, inline: true },
    { name: 'Status', value: `**${milestone.status}**`, inline: true },
    { name: 'Progress', value: `\`${renderY2kProgressBar(milestone.progressPercent, 10)}\``, inline: true },
    { name: 'Assigned Owner', value: milestone.ownerId ? `<@${milestone.ownerId}>` : '*Unassigned*', inline: true },
    { name: 'Linked Tasks', value: `${milestone.completedTaskCount}/${milestone.linkedTaskCount} shipped`, inline: true },
    { name: 'Deadline', value: milestone.deadlineAt ? formatInTimezone(milestone.deadlineAt) : 'Not set', inline: true }
  );

  const navRow = buildY2kNavBar('roadmap');
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`milestone:edit_modal:${milestone.id}`)
      .setLabel('Edit Stage')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`milestone:toggle_status:${milestone.id}`)
      .setLabel(isDone ? 'Mark In Progress' : 'Mark Completed')
      .setEmoji(isDone ? '🔄' : '✅')
      .setStyle(isDone ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`milestone:delete_confirm:${milestone.id}`)
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('milestone:back_to_roadmap')
      .setLabel('Back to Roadmap')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [navRow, actionRow] };
}

// 6. TEAM DIRECTORY PANEL
export function buildY2kTeamPanel(params: {
  guildId: string;
  staffSummary: Array<{
    id: string;
    displayName: string;
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    completionRate: number;
  }>;
}) {
  const config = getGuildConfig(params.guildId);
  const embed = createY2kEmbed({
    color: config.embedColor,
    title: '👥 STAFF DIRECTORY & WORKLOAD MATRIX',
    subtitle: 'Overview of team task distribution, active goals, and delivery throughput.',
    footerText: config.footerText,
  });

  if (params.staffSummary.length === 0) {
    embed.addFields({
      name: '✦ No Staff Tracked',
      value: '*No members have tasks assigned yet.*',
    });
  } else {
    for (const s of params.staffSummary.slice(0, 10)) {
      embed.addFields({
        name: `👤 ${s.displayName}`,
        value: `Pending: **${s.pendingTasks}** • Shipped: **${s.completedTasks}** • Total: **${s.totalTasks}** (Rate: ${s.completionRate}%)`,
        inline: true,
      });
    }
  }

  const navRow = buildY2kNavBar('team');
  return { embed, components: [navRow] };
}

// 7. SETTINGS PANEL
export function buildY2kSettingsPanel(params: {
  guildId: string;
  isOwner: boolean;
  canManage: boolean;
  authorisedUsers: AuthorisedUserView[];
  authorisedRoles: AuthorisedRoleView[];
}) {
  const config = getGuildConfig(params.guildId);
  const embed = createY2kEmbed({
    color: config.embedColor,
    title: '⚙️ BLOXPILOT WORKSPACE CONFIGURATION',
    subtitle: 'Customise your studio branding, task categories, deadlines and management permissions.',
    footerText: config.footerText,
  });

  embed.addFields(
    {
      name: '🎨 Branding & Identity',
      value: [
        `• Workspace: **${config.workspaceName}**`,
        `• Bot Name: **${config.botDisplayName}**`,
        `• Color Hex: \`#${config.embedColor.toString(16).padStart(6, '0')}\``,
      ].join('\n'),
      inline: true,
    },
    {
      name: '📋 Task System',
      value: [
        `• Categories: **${config.taskCategories.length}** active`,
        `• Default Priority: \`${config.defaultPriority}\``,
        `• Timezone: \`${config.defaultTimezone}\``,
      ].join('\n'),
      inline: true,
    },
    {
      name: '🛡️ Authorised Staff & Roles',
      value: [
        `• Authorised Users: **${params.authorisedUsers.length}**`,
        `• Authorised Roles: **${params.authorisedRoles.length}**`,
        params.isOwner ? '👑 *You are the Server Owner (Full Access)*' : params.canManage ? '🛡️ *Authorised Management*' : '👤 *Staff Access*',
      ].join('\n'),
      inline: false,
    }
  );

  const navRow = buildY2kNavBar('settings');

  // Settings Actions Buttons
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('settings:branding_modal')
      .setLabel('Edit Branding')
      .setEmoji('🎨')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!params.isOwner),
    new ButtonBuilder()
      .setCustomId('settings:categories_modal')
      .setLabel('Task Categories')
      .setEmoji('📁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!params.canManage),
    new ButtonBuilder()
      .setCustomId('settings:permissions_panel')
      .setLabel('Manage Roles & Users')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!params.isOwner)
  );

  return { embed, components: [navRow, actionRow] };
}
