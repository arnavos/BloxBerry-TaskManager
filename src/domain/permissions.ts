import type { PermissionContext } from './types.js';

export function isGuildOwner(ctx: Pick<PermissionContext, 'userId' | 'guildOwnerId'>): boolean {
  return Boolean(ctx.guildOwnerId && ctx.userId === ctx.guildOwnerId);
}

/**
 * Only the actual Discord server owner can authorise/revoke deadline permissions.
 */
export function canModifyDeadlinePermissions(
  ctx: Pick<PermissionContext, 'userId' | 'guildOwnerId'>
): boolean {
  return isGuildOwner(ctx);
}

/**
 * Returns true if the user is the guild owner, an explicitly authorised user,
 * or holds at least one explicitly authorised Discord role.
 */
export function canManageDeadlines(ctx: PermissionContext): boolean {
  if (isGuildOwner(ctx)) return true;
  if (ctx.authorisedUserIds.has(ctx.userId)) return true;
  for (const roleId of ctx.roleIds) {
    if (ctx.authorisedRoleIds.has(roleId)) return true;
  }
  return false;
}

export function canCompleteTask(
  ctx: PermissionContext,
  task: { assigneeId: string | null }
): boolean {
  if (isGuildOwner(ctx)) return true;
  if (canManageDeadlines(ctx)) return true;
  return Boolean(task.assigneeId && task.assigneeId === ctx.userId);
}

export function canUpdateTaskStatus(
  ctx: PermissionContext,
  task: { assigneeId: string | null; creatorId: string }
): boolean {
  if (isGuildOwner(ctx)) return true;
  if (canManageDeadlines(ctx)) return true;
  return task.assigneeId === ctx.userId || task.creatorId === ctx.userId;
}

export function canEditOrDeleteTask(
  ctx: PermissionContext,
  task: { creatorId: string }
): boolean {
  if (isGuildOwner(ctx)) return true;
  if (canManageDeadlines(ctx)) return true;
  return task.creatorId === ctx.userId;
}

export function canViewStaffTasks(ctx: PermissionContext, targetUserId: string): boolean {
  if (ctx.userId === targetUserId) return true;
  return canManageDeadlines(ctx);
}

export function canManageRoadmap(ctx: PermissionContext): boolean {
  return canManageDeadlines(ctx);
}
