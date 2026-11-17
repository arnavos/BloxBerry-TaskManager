import {
  DEFAULT_TIMEZONE,
  formatInTimezone,
  formatTaskCountdown,
  isDueTodayInTimezone,
  type CountdownResult,
} from '../domain/countdown.js';
import {
  canCompleteTask,
  canEditOrDeleteTask,
  canManageDeadlines,
  canUpdateTaskStatus,
} from '../domain/permissions.js';
import type { PermissionContext, TaskPriority, TaskStatus } from '../domain/types.js';
import { recordAuditLog } from './auditService.js';
import {
  discordStorage,
  type TaskData,
  type TaskHistoryData,
  type TaskAssignmentData,
} from '../storage/discordStorage.js';

export interface TaskView {
  id: number;
  guildId: string;
  title: string;
  description: string;
  projectCategory: string;
  priority: TaskPriority;
  status: TaskStatus;
  creatorId: string;
  creatorName: string;
  assigneeId: string | null;
  assigneeName: string;
  assigneeAvatarUrl: string | null;
  completedById: string | null;
  completedByName: string | null;
  deadlineAt: Date | null;
  deadlineFormatted: string | null;
  timezone: string;
  completedAt: Date | null;
  milestoneId: number | null;
  milestoneTitle: string | null;
  phaseId: number | null;
  discordMessageId: string | null;
  discordChannelId: string | null;
  countdown: CountdownResult;
  dmDeliveryFailed: boolean;
  dmFailureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  guildId: string;
  title: string;
  description?: string;
  projectCategory?: string;
  priority?: TaskPriority;
  assigneeId?: string | null;
  deadlineAt?: Date | null;
  timezone?: string;
  milestoneId?: number | null;
  phaseId?: number | null;
  actorName: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  projectCategory?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
  deadlineAt?: Date | null;
  clearDeadline?: boolean;
  milestoneId?: number | null;
  actorName: string;
}

export interface TaskFilter {
  guildId: string;
  assigneeId?: string;
  status?: TaskStatus | 'pending';
  priority?: TaskPriority;
  search?: string;
  projectCategory?: string;
  milestoneId?: number;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function enrichTasks(
  rows: TaskData[],
  guildId: string,
  now: Date = new Date()
): TaskView[] {
  if (rows.length === 0) return [];
  const store = discordStorage.getStore(guildId);

  const failedMap = new Map<number, string>();
  for (const n of store.notifications.values()) {
    if (n.deliveryStatus === 'failed_dm_disabled') {
      failedMap.set(n.taskId, n.errorMessage ?? 'Assignee DMs are disabled');
    }
  }

  return rows.map((row) => {
    const creator = store.users.get(row.creatorId);
    const assignee = row.assigneeId ? store.users.get(row.assigneeId) : undefined;
    const completedBy = row.completedById ? store.users.get(row.completedById) : undefined;
    const milestone = row.milestoneId ? store.milestones.get(row.milestoneId) : undefined;

    const tz = row.timezone || DEFAULT_TIMEZONE;
    const deadlineDate = row.deadlineAt ? new Date(row.deadlineAt) : null;
    const completedDate = row.completedAt ? new Date(row.completedAt) : null;
    const createdDate = new Date(row.createdAt);
    const updatedDate = new Date(row.updatedAt);

    const countdown = formatTaskCountdown(
      { status: row.status as TaskStatus, deadlineAt: deadlineDate },
      now
    );

    const effectiveStatus = (
      row.status !== 'Completed' &&
      row.status !== 'On Hold' &&
      countdown.isOverdue
        ? 'Overdue'
        : row.status
    ) as TaskStatus;

    return {
      id: row.id,
      guildId: row.guildId,
      title: row.title,
      description: row.description,
      projectCategory: row.projectCategory,
      priority: row.priority as TaskPriority,
      status: effectiveStatus,
      creatorId: row.creatorId,
      creatorName: creator?.displayName ?? creator?.username ?? row.creatorId,
      assigneeId: row.assigneeId,
      assigneeName: assignee?.displayName ?? assignee?.username ?? (row.assigneeId ?? 'Unassigned'),
      assigneeAvatarUrl: assignee?.avatarUrl ?? null,
      completedById: row.completedById,
      completedByName: completedBy
        ? completedBy.displayName ?? completedBy.username
        : row.completedById,
      deadlineAt: deadlineDate,
      deadlineFormatted: deadlineDate ? formatInTimezone(deadlineDate, tz) : null,
      timezone: tz,
      completedAt: completedDate,
      milestoneId: row.milestoneId,
      milestoneTitle: milestone?.title ?? null,
      phaseId: row.phaseId,
      discordMessageId: row.discordMessageId,
      discordChannelId: row.discordChannelId,
      countdown,
      dmDeliveryFailed: failedMap.has(row.id),
      dmFailureReason: failedMap.get(row.id) ?? null,
      createdAt: createdDate,
      updatedAt: updatedDate,
    };
  });
}

export async function createTask(
  input: CreateTaskInput,
  ctx: PermissionContext
): Promise<TaskView> {
  if (input.deadlineAt && !canManageDeadlines(ctx)) {
    throw new PermissionError(
      'You are not authorised to assign deadlines. Only the server owner or authorised staff/roles can set deadlines.'
    );
  }

  const store = discordStorage.getStore(input.guildId);
  const now = new Date();
  const initialStatus: TaskStatus =
    input.deadlineAt && input.deadlineAt.getTime() <= now.getTime()
      ? 'Overdue'
      : 'Not Started';

  store.nextTaskId += 1;
  const taskId = store.nextTaskId;

  const taskData: TaskData = {
    id: taskId,
    guildId: input.guildId,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    projectCategory: (input.projectCategory ?? 'General').trim() || 'General',
    priority: input.priority ?? 'Medium',
    status: initialStatus,
    creatorId: ctx.userId,
    assigneeId: input.assigneeId ?? ctx.userId,
    completedById: null,
    deadlineAt: input.deadlineAt ? input.deadlineAt.toISOString() : null,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    completedAt: null,
    milestoneId: input.milestoneId ?? null,
    phaseId: input.phaseId ?? null,
    discordMessageId: null,
    discordChannelId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await discordStorage.saveRecord(input.guildId, 'TASK', taskId, taskData);

  if (taskData.assigneeId) {
    const assignData: TaskAssignmentData = {
      id: `${taskId}_${taskData.assigneeId}`,
      taskId,
      userId: taskData.assigneeId,
      assignedById: ctx.userId,
      assignedAt: now.toISOString(),
    };
    await discordStorage.saveRecord(input.guildId, 'TASK', `assign_${taskId}`, assignData);
  }

  const historyId = `${taskId}_${Date.now()}`;
  const historyData: TaskHistoryData = {
    id: historyId,
    taskId,
    actorId: ctx.userId,
    action: 'created',
    previousStatus: null,
    newStatus: initialStatus,
    changes: {
      title: taskData.title,
      priority: taskData.priority,
      assigneeId: taskData.assigneeId,
      deadlineAt: taskData.deadlineAt,
    },
    createdAt: now.toISOString(),
  };
  await discordStorage.saveRecord(input.guildId, 'HISTORY', historyId, historyData);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: 'task',
    entityId: taskId,
    action: 'task_created',
    details: {
      title: taskData.title,
      assigneeId: taskData.assigneeId,
      priority: taskData.priority,
      hasDeadline: Boolean(taskData.deadlineAt),
    },
  });

  const [enriched] = enrichTasks([taskData], input.guildId, now);
  return enriched;
}

export async function getTaskById(
  taskId: number,
  guildId: string
): Promise<TaskView | null> {
  const store = discordStorage.getStore(guildId);
  const task = store.tasks.get(taskId);
  if (!task || task.guildId !== guildId) return null;
  const [enriched] = enrichTasks([task], guildId);
  return enriched;
}

export async function completeTask(
  taskId: number,
  ctx: PermissionContext,
  actorName: string
): Promise<TaskView> {
  const store = discordStorage.getStore(ctx.guildId);
  const existing = store.tasks.get(taskId);

  if (!existing || existing.guildId !== ctx.guildId) {
    throw new NotFoundError(`Task #${taskId} was not found.`);
  }

  if (!canCompleteTask(ctx, { assigneeId: existing.assigneeId })) {
    throw new PermissionError(
      'You can only mark your own assigned tasks as completed unless you have management/deadline permissions.'
    );
  }

  const now = new Date();
  existing.status = 'Completed';
  existing.completedById = ctx.userId;
  existing.completedAt = now.toISOString();
  existing.updatedAt = now.toISOString();

  await discordStorage.saveRecord(ctx.guildId, 'TASK', taskId, existing);

  const historyId = `${taskId}_${Date.now()}`;
  const historyData: TaskHistoryData = {
    id: historyId,
    taskId,
    actorId: ctx.userId,
    action: 'completed',
    previousStatus: existing.status,
    newStatus: 'Completed',
    changes: { completedAt: now.toISOString(), completedById: ctx.userId },
    createdAt: now.toISOString(),
  };
  await discordStorage.saveRecord(ctx.guildId, 'HISTORY', historyId, historyData);

  await recordAuditLog({
    guildId: ctx.guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'task',
    entityId: taskId,
    action: 'task_completed',
    details: { title: existing.title, previousStatus: existing.status },
  });

  const [enriched] = enrichTasks([existing], ctx.guildId, now);
  return enriched;
}

export async function updateTask(
  taskId: number,
  input: UpdateTaskInput,
  ctx: PermissionContext
): Promise<TaskView> {
  const store = discordStorage.getStore(ctx.guildId);
  const existing = store.tasks.get(taskId);

  if (!existing || existing.guildId !== ctx.guildId) {
    throw new NotFoundError(`Task #${taskId} was not found.`);
  }

  const isStatusOnlyUpdate =
    input.status !== undefined &&
    input.title === undefined &&
    input.description === undefined &&
    input.projectCategory === undefined &&
    input.priority === undefined &&
    input.assigneeId === undefined &&
    input.deadlineAt === undefined &&
    !input.clearDeadline &&
    input.milestoneId === undefined;

  if (isStatusOnlyUpdate) {
    if (input.status === 'Completed') {
      return completeTask(taskId, ctx, input.actorName);
    }
    if (!canUpdateTaskStatus(ctx, { assigneeId: existing.assigneeId, creatorId: existing.creatorId })) {
      throw new PermissionError('You are not allowed to update this task status.');
    }
  } else {
    const onlyReassigningOwnCreated = canEditOrDeleteTask(ctx, { creatorId: existing.creatorId });
    const isAssigneeUpdatingStatus =
      existing.assigneeId === ctx.userId &&
      input.title === undefined &&
      input.description === undefined &&
      input.assigneeId === undefined &&
      input.deadlineAt === undefined &&
      !input.clearDeadline;

    if (!onlyReassigningOwnCreated && !isAssigneeUpdatingStatus) {
      throw new PermissionError(
        'Only the task creator or authorised management members can edit this task.'
      );
    }
  }

  if ((input.deadlineAt !== undefined || input.clearDeadline) && !canManageDeadlines(ctx)) {
    throw new PermissionError(
      'You are not authorised to set, edit, or remove task deadlines.'
    );
  }

  if (input.status === 'Completed' && !canCompleteTask(ctx, { assigneeId: existing.assigneeId })) {
    throw new PermissionError('You are not permitted to mark this task as completed.');
  }

  const now = new Date();
  let nextDeadline = existing.deadlineAt;
  if (input.clearDeadline) nextDeadline = null;
  else if (input.deadlineAt !== undefined) nextDeadline = input.deadlineAt ? input.deadlineAt.toISOString() : null;

  let nextStatus = input.status ?? existing.status;
  if (input.clearDeadline && existing.status === 'Overdue') {
    nextStatus = 'In Progress';
  } else if (
    input.deadlineAt &&
    input.deadlineAt.getTime() > now.getTime() &&
    existing.status === 'Overdue' &&
    !input.status
  ) {
    nextStatus = 'In Progress';
  }

  const nextCompletedById =
    nextStatus === 'Completed' ? existing.completedById ?? ctx.userId : null;
  const nextCompletedAt =
    nextStatus === 'Completed' ? existing.completedAt ?? now.toISOString() : null;

  if (input.title !== undefined) existing.title = input.title.trim();
  if (input.description !== undefined) existing.description = input.description.trim();
  if (input.projectCategory !== undefined) existing.projectCategory = input.projectCategory.trim() || 'General';
  if (input.priority !== undefined) existing.priority = input.priority;
  existing.status = nextStatus;
  if (input.assigneeId !== undefined) existing.assigneeId = input.assigneeId;
  existing.deadlineAt = nextDeadline;
  existing.completedById = nextCompletedById;
  existing.completedAt = nextCompletedAt;
  if (input.milestoneId !== undefined) existing.milestoneId = input.milestoneId;
  existing.updatedAt = now.toISOString();

  await discordStorage.saveRecord(ctx.guildId, 'TASK', taskId, existing);

  // Clear existing notifications if deadline changed
  if (input.deadlineAt !== undefined || input.clearDeadline) {
    for (const [notifId, notif] of store.notifications.entries()) {
      if (notif.taskId === taskId) {
        await discordStorage.deleteRecord(ctx.guildId, 'NOTIFICATION', notifId);
      }
    }
  }

  const historyId = `${taskId}_${Date.now()}`;
  const historyData: TaskHistoryData = {
    id: historyId,
    taskId,
    actorId: ctx.userId,
    action: input.deadlineAt !== undefined || input.clearDeadline ? 'deadline_updated' : 'updated',
    previousStatus: existing.status,
    newStatus: nextStatus,
    changes: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.deadlineAt !== undefined
        ? { deadlineAt: input.deadlineAt?.toISOString() ?? null }
        : {}),
      ...(input.clearDeadline ? { deadlineCleared: true } : {}),
    },
    createdAt: now.toISOString(),
  };
  await discordStorage.saveRecord(ctx.guildId, 'HISTORY', historyId, historyData);

  await recordAuditLog({
    guildId: ctx.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: input.deadlineAt !== undefined || input.clearDeadline ? 'deadline' : 'task',
    entityId: taskId,
    action:
      input.deadlineAt !== undefined || input.clearDeadline
        ? input.clearDeadline
          ? 'deadline_removed'
          : 'deadline_updated'
        : 'task_updated',
    details: {
      title: existing.title,
      previousStatus: existing.status,
      newStatus: nextStatus,
    },
  });

  const [enriched] = enrichTasks([existing], ctx.guildId, now);
  return enriched;
}

export async function attachDiscordMessageRef(
  taskId: number,
  channelId: string,
  messageId: string,
  guildId?: string
): Promise<void> {
  const gids = guildId ? [guildId] : discordStorage.getAllGuildIds();
  for (const gid of gids) {
    const store = discordStorage.getStore(gid);
    const task = store.tasks.get(taskId);
    if (task) {
      task.discordChannelId = channelId;
      task.discordMessageId = messageId;
      task.updatedAt = new Date().toISOString();
      await discordStorage.saveRecord(gid, 'TASK', taskId, task);
      return;
    }
  }
}

export async function deleteTask(
  taskId: number,
  ctx: PermissionContext,
  actorName: string
): Promise<{ title: string }> {
  const store = discordStorage.getStore(ctx.guildId);
  const existing = store.tasks.get(taskId);

  if (!existing || existing.guildId !== ctx.guildId) {
    throw new NotFoundError(`Task #${taskId} was not found.`);
  }

  if (!canEditOrDeleteTask(ctx, { creatorId: existing.creatorId })) {
    throw new PermissionError(
      'Only the task creator or authorised management members can delete this task.'
    );
  }

  await recordAuditLog({
    guildId: ctx.guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'task',
    entityId: taskId,
    action: 'task_deleted',
    details: {
      title: existing.title,
      assigneeId: existing.assigneeId,
      status: existing.status,
    },
  });

  await discordStorage.deleteRecord(ctx.guildId, 'TASK', taskId);
  return { title: existing.title };
}

export async function listTasks(
  filter: TaskFilter,
  now: Date = new Date()
): Promise<TaskView[]> {
  const store = discordStorage.getStore(filter.guildId);
  let rows = [...store.tasks.values()].filter((t) => t.guildId === filter.guildId);

  if (filter.assigneeId) {
    rows = rows.filter((t) => t.assigneeId === filter.assigneeId);
  }
  if (filter.priority) {
    rows = rows.filter((t) => t.priority === filter.priority);
  }
  if (filter.projectCategory) {
    rows = rows.filter((t) => t.projectCategory === filter.projectCategory);
  }
  if (filter.milestoneId) {
    rows = rows.filter((t) => t.milestoneId === filter.milestoneId);
  }
  if (filter.status && filter.status !== 'pending' && filter.status !== 'Overdue') {
    rows = rows.filter((t) => t.status === filter.status);
  } else if (filter.status === 'pending') {
    rows = rows.filter((t) => ['Not Started', 'In Progress', 'Overdue', 'On Hold'].includes(t.status));
  }
  if (filter.search?.trim()) {
    const q = filter.search.trim().toLowerCase();
    rows = rows.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.projectCategory.toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const enriched = enrichTasks(rows, filter.guildId, now);

  if (filter.status === 'Overdue') {
    return enriched.filter((t) => t.status === 'Overdue');
  }

  return enriched;
}

export async function getTaskHistory(taskId: number, guildId?: string) {
  const gids = guildId ? [guildId] : discordStorage.getAllGuildIds();
  for (const gid of gids) {
    const store = discordStorage.getStore(gid);
    const historyList = [...store.taskHistory.values()]
      .filter((h) => h.taskId === taskId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (historyList.length > 0 || store.tasks.has(taskId)) {
      return historyList.map((h) => {
        const user = store.users.get(h.actorId);
        return {
          id: h.id,
          action: h.action,
          previousStatus: h.previousStatus,
          newStatus: h.newStatus,
          changes: h.changes,
          createdAt: new Date(h.createdAt),
          actorId: h.actorId,
          actorName: user?.displayName ?? user?.username ?? h.actorId,
        };
      });
    }
  }
  return [];
}

export async function getOrganizedTasksOverview(
  guildId: string,
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
) {
  const all = await listTasks({ guildId }, now);

  const dueToday = all.filter(
    (t) => t.status !== 'Completed' && isDueTodayInTimezone(t.deadlineAt, timezone, now)
  );
  const overdue = all.filter((t) => t.status === 'Overdue');
  const inProgress = all.filter((t) => t.status === 'In Progress');
  const completed = all.filter((t) => t.status === 'Completed');
  const upcomingDeadlines = all
    .filter(
      (t) =>
        t.status !== 'Completed' &&
        t.deadlineAt !== null &&
        t.deadlineAt.getTime() > now.getTime()
    )
    .sort((a, b) => a.deadlineAt!.getTime() - b.deadlineAt!.getTime());

  const byStaffMap = new Map<
    string,
    {
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      tasks: TaskView[];
      completedCount: number;
      overdueCount: number;
      inProgressCount: number;
      pendingCount: number;
    }
  >();

  for (const t of all) {
    const key = t.assigneeId ?? 'unassigned';
    const existing = byStaffMap.get(key) ?? {
      userId: key,
      displayName: t.assigneeName,
      avatarUrl: t.assigneeAvatarUrl,
      tasks: [],
      completedCount: 0,
      overdueCount: 0,
      inProgressCount: 0,
      pendingCount: 0,
    };
    existing.tasks.push(t);
    if (t.status === 'Completed') existing.completedCount++;
    else {
      existing.pendingCount++;
      if (t.status === 'Overdue') existing.overdueCount++;
      if (t.status === 'In Progress') existing.inProgressCount++;
    }
    byStaffMap.set(key, existing);
  }

  return {
    all,
    dueToday,
    upcomingDeadlines,
    overdue,
    completed,
    inProgress,
    byStaff: [...byStaffMap.values()].sort((a, b) => b.pendingCount - a.pendingCount),
  };
}

export async function getStaffDirectorySummary(
  guildId: string,
  now: Date = new Date()
) {
  const store = discordStorage.getStore(guildId);
  const allUsers = [...store.users.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const allTasks = await listTasks({ guildId }, now);

  const staffMap = new Map<
    string,
    {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      dmDisabled: boolean;
      roleIds: string[];
      totalTasks: number;
      completedTasks: number;
      inProgressTasks: number;
      pendingTasks: number;
      overdueTasks: number;
      completionRate: number;
      tasks: TaskView[];
    }
  >();

  for (const u of allUsers) {
    staffMap.set(u.id, {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      dmDisabled: u.dmDisabled,
      roleIds: u.roleIds,
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      pendingTasks: 0,
      overdueTasks: 0,
      completionRate: 0,
      tasks: [],
    });
  }

  for (const t of allTasks) {
    if (!t.assigneeId) continue;
    const entry = staffMap.get(t.assigneeId);
    if (!entry) continue;
    entry.tasks.push(t);
    entry.totalTasks++;
    if (t.status === 'Completed') {
      entry.completedTasks++;
    } else {
      entry.pendingTasks++;
      if (t.status === 'In Progress') entry.inProgressTasks++;
      if (t.status === 'Overdue') entry.overdueTasks++;
    }
  }

  const list = [...staffMap.values()].map((s) => ({
    ...s,
    completionRate: s.totalTasks > 0 ? Math.round((s.completedTasks / s.totalTasks) * 100) : 0,
  }));

  list.sort((a, b) => b.pendingTasks - a.pendingTasks || b.totalTasks - a.totalTasks);
  return list;
}

export async function listOverdueAlertNotifications(guildId: string) {
  const store = discordStorage.getStore(guildId);
  const notifs = [...store.notifications.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

  return notifs.map((n) => {
    const task = store.tasks.get(n.taskId);
    const user = store.users.get(n.recipientId);
    return {
      id: n.id,
      taskId: n.taskId,
      recipientId: n.recipientId,
      notificationType: n.notificationType,
      deliveryStatus: n.deliveryStatus,
      errorMessage: n.errorMessage,
      sentAt: n.sentAt ? new Date(n.sentAt) : null,
      createdAt: new Date(n.createdAt),
      taskTitle: task?.title ?? 'Unknown Task',
      taskStatus: task?.status ?? 'Unknown',
      recipientName: user?.displayName ?? user?.username ?? n.recipientId,
    };
  });
}
