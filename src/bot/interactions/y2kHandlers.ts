import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type RoleSelectMenuInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { parseDeadlineInput } from '../../domain/countdown.js';
import {
  canCompleteTask,
  canEditOrDeleteTask,
  canManageDeadlines,
  canManageRoadmap,
  isGuildOwner,
} from '../../domain/permissions.js';
import {
  TASK_PRIORITIES,
  type TaskPriority,
  type TaskStatus,
  type MilestoneStatus,
} from '../../domain/types.js';
import {
  buildPermissionContext,
  grantDeadlinePermission,
  listDeadlinePermissions,
  revokeDeadlinePermission,
} from '../../services/permissionService.js';
import {
  addDevelopmentPhase,
  addMilestone,
  createProject,
  deleteMilestone,
  deleteProject,
  getProjectRoadmapById,
  listProjectsWithRoadmaps,
  reorderMilestones,
  updateMilestone,
} from '../../services/roadmapService.js';
import {
  completeTask,
  createTask,
  deleteTask,
  getStaffDirectorySummary,
  getTaskById,
  listTasks,
  updateTask,
} from '../../services/taskService.js';
import { getGuildConfig, updateGuildConfig } from '../../services/configService.js';
import {
  buildY2kHomePanel,
  buildY2kNavBar,
  buildY2kRoadmapPanel,
  buildY2kSettingsPanel,
  buildY2kTaskCard,
  buildY2kTasksPanel,
  buildY2kTeamPanel,
  buildY2kMilestoneCard,
} from '../embeds/y2kPanels.js';
import { createY2kEmbed, Y2K_COLORS, Y2K_MESSAGES } from '../../domain/y2kTheme.js';

// Temporary memory store for modal flows (e.g. Add Goal -> member selection)
const pendingGoalData = new Map<string, {
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  deadline?: Date;
  deadlineRaw?: string;
}>();

export async function handleY2kButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const { customId, guild, user } = interaction;
  if (!guild) return;

  const roleIds = interaction.member && 'roles' in interaction.member && interaction.member.roles && 'cache' in interaction.member.roles
    ? [...interaction.member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => r.id)
    : [];

  const ctx = await buildPermissionContext({
    guildId: guild.id,
    userId: user.id,
    roleIds,
    guildOwnerId: guild.ownerId,
  });

  const actorName = (interaction.member && 'displayName' in interaction.member)
    ? (interaction.member.displayName as string)
    : user.username;

  // 1. Navigation Buttons
  if (customId === 'nav:home') {
    const tasks = await listTasks({ guildId: guild.id });
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kHomePanel({
      guildId: guild.id,
      userName: actorName,
      project: roadmaps[0] ?? null,
      tasks,
    });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  if (customId === 'nav:tasks' || customId === 'home:quick_tasks' || customId === 'task:back_to_list') {
    const tasks = await listTasks({ guildId: guild.id });
    const panel = buildY2kTasksPanel({ guildId: guild.id, tasks, activeFilter: 'all', page: 1 });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  if (customId === 'nav:roadmap' || customId === 'home:quick_roadmap' || customId === 'milestone:back_to_roadmap') {
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  if (customId === 'nav:team') {
    const staffSummary = await getStaffDirectorySummary(guild.id);
    const panel = buildY2kTeamPanel({ guildId: guild.id, staffSummary });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  if (customId === 'nav:settings') {
    const perms = await listDeadlinePermissions(guild.id);
    const panel = buildY2kSettingsPanel({
      guildId: guild.id,
      isOwner: isGuildOwner(ctx),
      canManage: canManageDeadlines(ctx),
      authorisedUsers: perms.authorisedUsers,
      authorisedRoles: perms.authorisedRoles,
    });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  // 2. Add Goal Modal trigger
  if (customId === 'task:add_goal_modal') {
    const canSetDl = canManageDeadlines(ctx);
    const config = getGuildConfig(guild.id);

    const modal = new ModalBuilder()
      .setCustomId('modal:add_goal')
      .setTitle('✦ Add Goal — Task Specification');

    const titleInput = new TextInputBuilder()
      .setCustomId('goal_title')
      .setLabel('Task Title')
      .setPlaceholder('e.g. Implement Inventory Drag & Drop')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(180);

    const descInput = new TextInputBuilder()
      .setCustomId('goal_description')
      .setLabel('Task Description & Acceptance Criteria')
      .setPlaceholder('Describe mechanics, constraints, or testing notes...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const catInput = new TextInputBuilder()
      .setCustomId('goal_category')
      .setLabel(`Category (${config.taskCategories.slice(0, 4).join(', ')})`)
      .setPlaceholder('e.g. Core Gameplay')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.taskCategories[0] ?? 'General');

    const prioInput = new TextInputBuilder()
      .setCustomId('goal_priority')
      .setLabel('Priority (Low, Medium, High, Urgent)')
      .setPlaceholder('Medium')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.defaultPriority);

    const dlInput = new TextInputBuilder()
      .setCustomId('goal_deadline')
      .setLabel(canSetDl ? 'Deadline (e.g. 2026-11-20 18:00 or "tomorrow 6pm")' : 'Deadline [DISABLED - Authorised Only]')
      .setPlaceholder(canSetDl ? 'Optional: YYYY-MM-DD HH:mm or "in 2 days"' : 'Leave blank - only authorised staff can set deadlines')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(catInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(prioInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(dlInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // 3. Task Quick Actions
  if (customId.startsWith('task:toggle_complete:')) {
    const taskId = Number(customId.split(':')[2]);
    const task = await getTaskById(taskId, guild.id);
    if (!task) {
      await interaction.reply({ content: '❌ Task not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (task.status === 'Completed') {
      const updated = await updateTask(taskId, { status: 'In Progress', actorName }, ctx);
      const card = buildY2kTaskCard(updated);
      await interaction.update({ embeds: [card.embed], components: card.components });
    } else {
      const completed = await completeTask(taskId, ctx, actorName);
      const card = buildY2kTaskCard(completed);
      await interaction.update({ embeds: [card.embed], components: card.components });
    }
    return;
  }

  if (customId.startsWith('task:start:')) {
    const taskId = Number(customId.split(':')[2]);
    const updated = await updateTask(taskId, { status: 'In Progress', actorName }, ctx);
    const card = buildY2kTaskCard(updated);
    await interaction.update({ embeds: [card.embed], components: card.components });
    return;
  }

  if (customId.startsWith('task:delete_confirm:')) {
    const taskId = Number(customId.split(':')[2]);
    await deleteTask(taskId, ctx, actorName);
    const tasks = await listTasks({ guildId: guild.id });
    const panel = buildY2kTasksPanel({ guildId: guild.id, tasks, activeFilter: 'all', page: 1 });
    await interaction.update({
      content: `🗑️ Goal **#${taskId}** deleted from workspace.`,
      embeds: [panel.embed],
      components: panel.components,
    });
    return;
  }

  if (customId.startsWith('task:reassign_menu:')) {
    const taskId = customId.split(':')[2];
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`task:reassign_select:${taskId}`)
      .setPlaceholder('Select new staff member for this task...');
    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect);
    await interaction.reply({
      content: 'Select the staff member to reassign this goal to:',
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Tasks Pagination
  if (customId.startsWith('tasks:page:')) {
    const [, , pageStr, filter] = customId.split(':');
    const tasks = await listTasks({ guildId: guild.id });
    const panel = buildY2kTasksPanel({
      guildId: guild.id,
      tasks,
      activeFilter: filter,
      page: Number(pageStr),
    });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  // 5. Roadmap Controls
  if (customId === 'roadmap:create_project_modal') {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId('modal:create_project')
      .setTitle('✦ Initialize New Project');

    const nameInput = new TextInputBuilder()
      .setCustomId('proj_name')
      .setLabel('Project Title')
      .setPlaceholder('e.g. Project Overdrive')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('proj_desc')
      .setLabel('Description')
      .setPlaceholder('Roblox game concept, target release...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('roadmap:add_milestone_modal:')) {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const projectId = customId.split(':')[2];
    const modal = new ModalBuilder()
      .setCustomId(`modal:add_milestone:${projectId}`)
      .setTitle('✦ Add Milestone / Stage');

    const titleInput = new TextInputBuilder()
      .setCustomId('m_title')
      .setLabel('Stage / Milestone Title')
      .setPlaceholder('e.g. Map & Environment Blockout')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('m_desc')
      .setLabel('Description & Goals')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('milestone:delete_confirm:')) {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const milestoneId = Number(customId.split(':')[2]);
    const res = await deleteMilestone(milestoneId, guild.id, ctx, actorName);
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps, activeProjectId: res.projectId });
    await interaction.update({
      content: `🗑️ Stage "${res.title}" removed from roadmap.`,
      embeds: [panel.embed],
      components: panel.components,
    });
    return;
  }

  if (customId.startsWith('milestone:toggle_status:')) {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const milestoneId = Number(customId.split(':')[2]);
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    let targetM: any;
    let projName = '';
    for (const p of roadmaps) {
      const found = p.milestones.find((m) => m.id === milestoneId);
      if (found) {
        targetM = found;
        projName = p.name;
        break;
      }
    }
    if (targetM) {
      const nextStatus: MilestoneStatus = targetM.status === 'Completed' ? 'In Progress' : 'Completed';
      const updated = await updateMilestone(milestoneId, { guildId: guild.id, status: nextStatus, actorName }, ctx);
      const card = buildY2kMilestoneCard(updated, projName);
      await interaction.update({ embeds: [card.embed], components: card.components });
    }
    return;
  }

  // 6. Settings Buttons
  if (customId === 'settings:branding_modal') {
    if (!isGuildOwner(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.SERVER_OWNER_REQUIRED, flags: MessageFlags.Ephemeral });
      return;
    }
    const config = getGuildConfig(guild.id);
    const modal = new ModalBuilder()
      .setCustomId('modal:settings_branding')
      .setTitle('✦ Workspace Branding');

    const nameInput = new TextInputBuilder()
      .setCustomId('brand_name')
      .setLabel('Workspace Title')
      .setValue(config.workspaceName)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const msgInput = new TextInputBuilder()
      .setCustomId('brand_welcome')
      .setLabel('Custom Welcome Note')
      .setValue(config.welcomeMessage)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput)
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'settings:categories_modal') {
    if (!canManageDeadlines(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const config = getGuildConfig(guild.id);
    const modal = new ModalBuilder()
      .setCustomId('modal:settings_categories')
      .setTitle('✦ Task Categories');

    const catsInput = new TextInputBuilder()
      .setCustomId('categories_list')
      .setLabel('Categories (Comma Separated)')
      .setValue(config.taskCategories.join(', '))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(catsInput));
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'settings:permissions_panel') {
    if (!isGuildOwner(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.SERVER_OWNER_REQUIRED, flags: MessageFlags.Ephemeral });
      return;
    }

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId('settings:auth_user_select')
      .setPlaceholder('Authorise or revoke user deadline permissions...');
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('settings:auth_role_select')
      .setPlaceholder('Authorise or revoke role deadline permissions...');

    const embed = createY2kEmbed({
      title: '🛡️ PERMISSIONS & GOVERNANCE ROSTER',
      subtitle: 'Select users or roles to grant or revoke deadline management authority.',
    });

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

// Dropdown / Select Menu Interaction Handlers
export async function handleY2kSelectInteraction(
  interaction: StringSelectMenuInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction
): Promise<void> {
  const { customId, guild, user } = interaction;
  if (!guild) return;

  const roleIds = interaction.member && 'roles' in interaction.member && interaction.member.roles && 'cache' in interaction.member.roles
    ? [...interaction.member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => r.id)
    : [];

  const ctx = await buildPermissionContext({
    guildId: guild.id,
    userId: user.id,
    roleIds,
    guildOwnerId: guild.ownerId,
  });

  const actorName = (interaction.member && 'displayName' in interaction.member)
    ? (interaction.member.displayName as string)
    : user.username;

  // Filter Tasks by status
  if (customId === 'tasks:filter_select' && interaction.isStringSelectMenu()) {
    const selectedFilter = interaction.values[0];
    const tasks = await listTasks({ guildId: guild.id });
    const panel = buildY2kTasksPanel({
      guildId: guild.id,
      tasks,
      activeFilter: selectedFilter,
      page: 1,
    });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  // Inspect Task Details
  if (customId === 'tasks:inspect_task' && interaction.isStringSelectMenu()) {
    const val = interaction.values[0];
    const taskId = Number(val.replace('task_view:', ''));
    const task = await getTaskById(taskId, guild.id);
    if (!task) {
      await interaction.reply({ content: '❌ Task not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    const card = buildY2kTaskCard(task);
    await interaction.update({ embeds: [card.embed], components: card.components });
    return;
  }

  // Reassign Task Member
  if (customId.startsWith('task:reassign_select:') && interaction.isUserSelectMenu()) {
    const taskId = Number(customId.split(':')[2]);
    const targetUserId = interaction.values[0];
    const updated = await updateTask(taskId, { assigneeId: targetUserId, actorName }, ctx);
    const card = buildY2kTaskCard(updated);
    await interaction.update({
      content: `✓ Reassigned Task **#${taskId}** to <@${targetUserId}>!`,
      embeds: [card.embed],
      components: card.components,
    });
    return;
  }

  // Select Milestone
  if (customId === 'roadmap:select_milestone' && interaction.isStringSelectMenu()) {
    const val = interaction.values[0];
    const milestoneId = Number(val.replace('milestone_view:', ''));
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    let targetM: any;
    let projName = '';
    for (const p of roadmaps) {
      const found = p.milestones.find((m) => m.id === milestoneId);
      if (found) {
        targetM = found;
        projName = p.name;
        break;
      }
    }
    if (!targetM) {
      await interaction.reply({ content: '❌ Milestone not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    const card = buildY2kMilestoneCard(targetM, projName);
    await interaction.update({ embeds: [card.embed], components: card.components });
    return;
  }

  // Switch Active Project
  if (customId === 'roadmap:switch_project' && interaction.isStringSelectMenu()) {
    const projId = Number(interaction.values[0].replace('switch_project:', ''));
    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps, activeProjectId: projId });
    await interaction.update({ embeds: [panel.embed], components: panel.components });
    return;
  }

  // Assign Goal to Member (Step 2 of Add Goal Modal)
  if (customId.startsWith('task:assign_member_for_goal:') && interaction.isUserSelectMenu()) {
    const pendingKey = customId.split(':')[2];
    const goalData = pendingGoalData.get(pendingKey);
    const targetUserId = interaction.values[0];
    pendingGoalData.delete(pendingKey);

    if (!goalData) {
      await interaction.reply({ content: '⚠️ Task creation timed out. Please click "Add Goal" again.', flags: MessageFlags.Ephemeral });
      return;
    }

    const task = await createTask(
      {
        guildId: guild.id,
        title: goalData.title,
        description: goalData.description,
        projectCategory: goalData.category,
        priority: goalData.priority,
        assigneeId: targetUserId,
        deadlineAt: goalData.deadline,
        actorName,
      },
      ctx
    );

    const card = buildY2kTaskCard(task);
    await interaction.update({
      content: `✦ Goal **#${task.id}** scheduled and assigned to <@${targetUserId}>!`,
      embeds: [card.embed],
      components: card.components,
    });
    return;
  }

  // Authorise / Revoke User
  if (customId === 'settings:auth_user_select' && interaction.isUserSelectMenu()) {
    if (!isGuildOwner(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.SERVER_OWNER_REQUIRED, flags: MessageFlags.Ephemeral });
      return;
    }
    const targetUserId = interaction.values[0];
    const perms = await listDeadlinePermissions(guild.id);
    const already = perms.authorisedUsers.some((u) => u.userId === targetUserId);

    if (already) {
      await revokeDeadlinePermission({
        guildId: guild.id,
        targetType: 'user',
        targetId: targetUserId,
        targetLabel: targetUserId,
        actorId: ctx.userId,
        actorName,
        guildOwnerId: guild.ownerId,
      });
      await interaction.reply({ content: `✓ Revoked deadline management authorization from <@${targetUserId}>.`, flags: MessageFlags.Ephemeral });
    } else {
      await grantDeadlinePermission({
        guildId: guild.id,
        targetType: 'user',
        targetId: targetUserId,
        targetLabel: targetUserId,
        actorId: ctx.userId,
        actorName,
        guildOwnerId: guild.ownerId,
      });
      await interaction.reply({ content: `✓ Granted deadline management authorization to <@${targetUserId}>.`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // Authorise / Revoke Role
  if (customId === 'settings:auth_role_select' && interaction.isRoleSelectMenu()) {
    if (!isGuildOwner(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.SERVER_OWNER_REQUIRED, flags: MessageFlags.Ephemeral });
      return;
    }
    const targetRoleId = interaction.values[0];
    const perms = await listDeadlinePermissions(guild.id);
    const already = perms.authorisedRoles.some((r) => r.roleId === targetRoleId);

    if (already) {
      await revokeDeadlinePermission({
        guildId: guild.id,
        targetType: 'role',
        targetId: targetRoleId,
        targetLabel: targetRoleId,
        actorId: ctx.userId,
        actorName,
        guildOwnerId: guild.ownerId,
      });
      await interaction.reply({ content: `✓ Revoked deadline management authorization from role <@&${targetRoleId}>.`, flags: MessageFlags.Ephemeral });
    } else {
      await grantDeadlinePermission({
        guildId: guild.id,
        targetType: 'role',
        targetId: targetRoleId,
        targetLabel: targetRoleId,
        actorId: ctx.userId,
        actorName,
        guildOwnerId: guild.ownerId,
      });
      await interaction.reply({ content: `✓ Granted deadline management authorization to role <@&${targetRoleId}>.`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
}

// Modal Submission Handlers
export async function handleY2kModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId, guild, user } = interaction;
  if (!guild) return;

  const roleIds = interaction.member && 'roles' in interaction.member && interaction.member.roles && 'cache' in interaction.member.roles
    ? [...interaction.member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => r.id)
    : [];

  const ctx = await buildPermissionContext({
    guildId: guild.id,
    userId: user.id,
    roleIds,
    guildOwnerId: guild.ownerId,
  });

  const actorName = (interaction.member && 'displayName' in interaction.member)
    ? (interaction.member.displayName as string)
    : user.username;

  // Add Goal Form Submitted -> Open Member Dropdown
  if (customId === 'modal:add_goal') {
    const title = interaction.fields.getTextInputValue('goal_title').trim();
    const description = interaction.fields.getTextInputValue('goal_description').trim();
    const category = interaction.fields.getTextInputValue('goal_category').trim() || 'General';
    const priorityRaw = interaction.fields.getTextInputValue('goal_priority').trim();
    const deadlineRaw = interaction.fields.getTextInputValue('goal_deadline').trim();

    let priority: TaskPriority = 'Medium';
    const found = TASK_PRIORITIES.find((p: string) => p.toLowerCase() === priorityRaw.toLowerCase());
    if (found) priority = found;

    let deadline: Date | undefined;
    if (deadlineRaw) {
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content: '⚠️ You are not authorised to assign deadlines. Please clear the deadline or contact management.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      try {
        const parsed = parseDeadlineInput(deadlineRaw, getGuildConfig(guild.id).defaultTimezone);
        deadline = parsed.date;
      } catch (err) {
        await interaction.reply({
          content: `❌ Could not parse deadline: "${deadlineRaw}". Format as YYYY-MM-DD HH:mm or "tomorrow 6pm".`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const pendingKey = `${user.id}_${Date.now()}`;
    pendingGoalData.set(pendingKey, { title, description, category, priority, deadline, deadlineRaw });

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`task:assign_member_for_goal:${pendingKey}`)
      .setPlaceholder('Assign this goal to a team member (or select yourself)...');

    const embed = createY2kEmbed({
      title: '👤 SELECT ASSIGNED TEAM MEMBER',
      subtitle: `Goal: **${title}** (${priority} • \`${category}\`)\nSelect a member below to finalize creation.`,
    });

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Create Project
  if (customId === 'modal:create_project') {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const name = interaction.fields.getTextInputValue('proj_name').trim();
    const description = interaction.fields.getTextInputValue('proj_desc').trim();

    const created = await createProject(
      { guildId: guild.id, name, description, seedDefaultStages: false, actorName },
      ctx
    );

    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps, activeProjectId: created.id });
    await interaction.reply({
      content: `✦ Project **${created.name}** initialized! Add custom milestones below.`,
      embeds: [panel.embed],
      components: panel.components,
    });
    return;
  }

  // Add Milestone
  if (customId.startsWith('modal:add_milestone:')) {
    if (!canManageRoadmap(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const projectId = Number(customId.split(':')[2]);
    const title = interaction.fields.getTextInputValue('m_title').trim();
    const description = interaction.fields.getTextInputValue('m_desc').trim();

    await addMilestone(
      {
        guildId: guild.id,
        projectId,
        title,
        description,
        actorName,
      },
      ctx
    );

    const roadmaps = await listProjectsWithRoadmaps(guild.id);
    const panel = buildY2kRoadmapPanel({ guildId: guild.id, projects: roadmaps, activeProjectId: projectId });
    await interaction.reply({
      content: `✦ Stage **${title}** added to roadmap!`,
      embeds: [panel.embed],
      components: panel.components,
    });
    return;
  }

  // Branding Settings Update
  if (customId === 'modal:settings_branding') {
    if (!isGuildOwner(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.SERVER_OWNER_REQUIRED, flags: MessageFlags.Ephemeral });
      return;
    }
    const workspaceName = interaction.fields.getTextInputValue('brand_name').trim();
    const welcomeMessage = interaction.fields.getTextInputValue('brand_welcome').trim();

    await updateGuildConfig(guild.id, { workspaceName, welcomeMessage }, ctx, actorName);
    const perms = await listDeadlinePermissions(guild.id);
    const panel = buildY2kSettingsPanel({
      guildId: guild.id,
      isOwner: true,
      canManage: true,
      authorisedUsers: perms.authorisedUsers,
      authorisedRoles: perms.authorisedRoles,
    });
    await interaction.reply({
      content: '✓ Workspace branding updated.',
      embeds: [panel.embed],
      components: panel.components,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Categories Settings Update
  if (customId === 'modal:settings_categories') {
    if (!canManageDeadlines(ctx)) {
      await interaction.reply({ content: Y2K_MESSAGES.UNAUTHORISED, flags: MessageFlags.Ephemeral });
      return;
    }
    const raw = interaction.fields.getTextInputValue('categories_list');
    const categories = raw.split(',').map((c) => c.trim()).filter((c) => c.length > 0);

    await updateGuildConfig(guild.id, { taskCategories: categories }, ctx, actorName);
    const perms = await listDeadlinePermissions(guild.id);
    const panel = buildY2kSettingsPanel({
      guildId: guild.id,
      isOwner: isGuildOwner(ctx),
      canManage: true,
      authorisedUsers: perms.authorisedUsers,
      authorisedRoles: perms.authorisedRoles,
    });
    await interaction.reply({
      content: `✓ Task categories updated (${categories.length} categories active).`,
      embeds: [panel.embed],
      components: panel.components,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}
