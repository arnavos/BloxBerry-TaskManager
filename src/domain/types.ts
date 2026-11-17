export const TASK_STATUSES = [
  'Not Started',
  'In Progress',
  'Completed',
  'Overdue',
  'On Hold',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = [
  'Not Started',
  'Planning',
  'In Progress',
  'Blocked',
  'Completed',
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PHASE_STATUSES = [
  'Not Started',
  'In Progress',
  'Blocked',
  'Completed',
] as const;

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const PERMISSION_TARGET_TYPES = ['user', 'role'] as const;
export type PermissionTargetType = (typeof PERMISSION_TARGET_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'due_now',
  'overdue_assignee',
  'overdue_management',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DELIVERY_STATUSES = [
  'pending',
  'sent',
  'failed_dm_disabled',
  'dashboard_only',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface PermissionContext {
  userId: string;
  guildId: string;
  guildOwnerId: string | null;
  roleIds: string[];
  authorisedUserIds: Set<string>;
  authorisedRoleIds: Set<string>;
}
