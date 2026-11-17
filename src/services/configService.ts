import { discordStorage, type GuildSettingsData } from '../storage/discordStorage.js';
import { DEFAULT_BRAND_COLOR, Y2K_COLORS } from '../domain/y2kTheme.js';
import { TASK_PRIORITIES, TASK_STATUSES } from '../domain/types.js';
import { recordAuditLog } from './auditService.js';
import { isGuildOwner, canManageDeadlines } from '../domain/permissions.js';
import type { PermissionContext } from '../domain/types.js';

export const DEFAULT_TASK_CATEGORIES = [
  'General',
  'Core Gameplay',
  'Map & World',
  'UI/UX',
  'Art & Animation',
  'Backend & Systems',
  'Audio & SFX',
  'QA & Testing',
];

export interface WorkspaceConfig {
  workspaceName: string;
  botDisplayName: string;
  logoUrl: string | null;
  embedColor: number;
  welcomeMessage: string;
  footerText: string;
  taskCategories: string[];
  taskPriorities: string[];
  taskStatuses: string[];
  defaultPriority: string;
  defaultTimezone: string;
  reminderIntervalMs: number;
  overdueEscalationMinutes: number;
  activeProjectId: number | null;
}

export function getGuildConfig(guildId: string): WorkspaceConfig {
  const store = discordStorage.getStore(guildId);
  const s = store.settings;

  return {
    workspaceName: s?.workspaceName || s?.guildName || 'Bloxberry Labs Workspace',
    botDisplayName: s?.botDisplayName || 'BloxPilot',
    logoUrl: s?.logoUrl ?? null,
    embedColor: s?.embedColor ?? DEFAULT_BRAND_COLOR,
    welcomeMessage: s?.welcomeMessage || 'Your workspace is ready. Let’s get things shipped.',
    footerText: s?.footerText || 'BloxPilot ◈ Bloxberry Labs Workspace',
    taskCategories: s?.taskCategories && s.taskCategories.length > 0 ? s.taskCategories : DEFAULT_TASK_CATEGORIES,
    taskPriorities: s?.taskPriorities && s.taskPriorities.length > 0 ? s.taskPriorities : [...TASK_PRIORITIES],
    taskStatuses: s?.taskStatuses && s.taskStatuses.length > 0 ? s.taskStatuses : [...TASK_STATUSES],
    defaultPriority: s?.defaultPriority || 'Medium',
    defaultTimezone: s?.defaultTimezone || 'Asia/Kolkata',
    reminderIntervalMs: s?.reminderIntervalMs || 30000,
    overdueEscalationMinutes: s?.overdueEscalationMinutes || 120,
    activeProjectId: s?.activeProjectId ?? null,
  };
}

export async function updateGuildConfig(
  guildId: string,
  updates: Partial<WorkspaceConfig>,
  ctx: PermissionContext,
  actorName: string
): Promise<WorkspaceConfig> {
  // Only server owner or authorised management members can update settings
  if (!canManageDeadlines(ctx)) {
    throw new Error('Only the server owner or authorised management can update workspace settings.');
  }

  // Branding color or workspace renaming restricted to server owner
  if ((updates.workspaceName !== undefined || updates.embedColor !== undefined) && !isGuildOwner(ctx)) {
    throw new Error('Only the server owner can alter primary workspace branding.');
  }

  const store = discordStorage.getStore(guildId);
  const now = new Date().toISOString();

  const current = store.settings ?? {
    guildId,
    guildName: 'Bloxberry Labs Workspace',
    ownerId: ctx.guildOwnerId ?? ctx.userId,
    updatedAt: now,
  };

  const updatedSettings: GuildSettingsData = {
    ...current,
    updatedAt: now,
    ...(updates.workspaceName !== undefined ? { workspaceName: updates.workspaceName.trim() } : {}),
    ...(updates.botDisplayName !== undefined ? { botDisplayName: updates.botDisplayName.trim() } : {}),
    ...(updates.logoUrl !== undefined ? { logoUrl: updates.logoUrl } : {}),
    ...(updates.embedColor !== undefined ? { embedColor: updates.embedColor } : {}),
    ...(updates.welcomeMessage !== undefined ? { welcomeMessage: updates.welcomeMessage.trim() } : {}),
    ...(updates.footerText !== undefined ? { footerText: updates.footerText.trim() } : {}),
    ...(updates.taskCategories !== undefined ? { taskCategories: updates.taskCategories } : {}),
    ...(updates.taskPriorities !== undefined ? { taskPriorities: updates.taskPriorities } : {}),
    ...(updates.taskStatuses !== undefined ? { taskStatuses: updates.taskStatuses } : {}),
    ...(updates.defaultPriority !== undefined ? { defaultPriority: updates.defaultPriority } : {}),
    ...(updates.defaultTimezone !== undefined ? { defaultTimezone: updates.defaultTimezone } : {}),
    ...(updates.reminderIntervalMs !== undefined ? { reminderIntervalMs: updates.reminderIntervalMs } : {}),
    ...(updates.overdueEscalationMinutes !== undefined ? { overdueEscalationMinutes: updates.overdueEscalationMinutes } : {}),
    ...(updates.activeProjectId !== undefined ? { activeProjectId: updates.activeProjectId } : {}),
  };

  await discordStorage.saveRecord(guildId, 'SETTINGS', guildId, updatedSettings);

  await recordAuditLog({
    guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'system',
    entityId: guildId,
    action: 'settings_updated',
    details: updates as Record<string, unknown>,
  });

  return getGuildConfig(guildId);
}
