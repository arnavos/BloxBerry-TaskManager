import { discordStorage, type AuditLogData } from '../storage/discordStorage.js';

export interface AuditEntryInput {
  guildId: string;
  actorId: string;
  actorName: string;
  entityType: 'task' | 'deadline' | 'permission' | 'roadmap' | 'milestone' | 'phase' | 'system';
  entityId: string | number;
  action: string;
  details?: Record<string, unknown>;
}

export async function recordAuditLog(
  input: AuditEntryInput
): Promise<void> {
  const now = new Date().toISOString();
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const auditData: AuditLogData = {
    id,
    guildId: input.guildId,
    actorId: input.actorId,
    actorName: input.actorName,
    entityType: input.entityType,
    entityId: String(input.entityId),
    action: input.action,
    details: input.details ?? {},
    createdAt: now,
  };

  await discordStorage.saveRecord(input.guildId, 'AUDIT', id, auditData);
}

export async function listRecentAuditLogs(
  guildId: string,
  limit: number = 50
): Promise<AuditLogData[]> {
  const store = discordStorage.getStore(guildId);
  const logs = [...store.auditLogs.values()];
  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return logs.slice(0, Math.min(Math.max(limit, 1), 200));
}
