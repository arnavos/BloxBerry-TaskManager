import { canModifyDeadlinePermissions } from '../domain/permissions.js';
import type { PermissionContext, PermissionTargetType } from '../domain/types.js';
import { recordAuditLog } from './auditService.js';
import { discordStorage, type DeadlinePermissionData } from '../storage/discordStorage.js';

export async function buildPermissionContext(params: {
  guildId: string;
  userId: string;
  roleIds?: string[];
  guildOwnerId?: string | null;
}): Promise<PermissionContext> {
  const store = discordStorage.getStore(params.guildId);

  let ownerId = params.guildOwnerId ?? null;
  if (!ownerId) {
    ownerId = store.settings?.ownerId ?? null;
  }

  let roleIds = params.roleIds;
  if (!roleIds) {
    const user = store.users.get(params.userId);
    roleIds = user?.roleIds ?? [];
  }

  const authorisedUserIds = new Set<string>();
  const authorisedRoleIds = new Set<string>();

  for (const perm of store.permissions.values()) {
    if (perm.guildId === params.guildId && perm.active) {
      if (perm.targetType === 'user') {
        authorisedUserIds.add(perm.targetId);
      } else if (perm.targetType === 'role') {
        authorisedRoleIds.add(perm.targetId);
      }
    }
  }

  return {
    userId: params.userId,
    guildId: params.guildId,
    guildOwnerId: ownerId,
    roleIds,
    authorisedUserIds,
    authorisedRoleIds,
  };
}

export async function grantDeadlinePermission(input: {
  guildId: string;
  targetType: PermissionTargetType;
  targetId: string;
  targetLabel: string;
  actorId: string;
  actorName: string;
  guildOwnerId: string | null;
}): Promise<{ alreadyActive: boolean }> {
  if (!canModifyDeadlinePermissions({ userId: input.actorId, guildOwnerId: input.guildOwnerId })) {
    throw new Error('Only the Discord server owner can authorise deadline permissions.');
  }

  const store = discordStorage.getStore(input.guildId);
  for (const perm of store.permissions.values()) {
    if (
      perm.guildId === input.guildId &&
      perm.targetType === input.targetType &&
      perm.targetId === input.targetId &&
      perm.active
    ) {
      return { alreadyActive: true };
    }
  }

  const permId = `${input.targetType}:${input.targetId}`;
  const now = new Date().toISOString();
  const permData: DeadlinePermissionData = {
    id: permId,
    guildId: input.guildId,
    targetType: input.targetType,
    targetId: input.targetId,
    grantedById: input.actorId,
    active: true,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
  };

  await discordStorage.saveRecord(input.guildId, 'PERMISSION', permId, permData);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: input.actorId,
    actorName: input.actorName,
    entityType: 'permission',
    entityId: `${input.targetType}:${input.targetId}`,
    action: 'deadline_permission_granted',
    details: {
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
    },
  });

  return { alreadyActive: false };
}

export async function revokeDeadlinePermission(input: {
  guildId: string;
  targetType: PermissionTargetType;
  targetId: string;
  targetLabel: string;
  actorId: string;
  actorName: string;
  guildOwnerId: string | null;
}): Promise<{ revoked: boolean }> {
  if (!canModifyDeadlinePermissions({ userId: input.actorId, guildOwnerId: input.guildOwnerId })) {
    throw new Error('Only the Discord server owner can revoke deadline permissions.');
  }

  const store = discordStorage.getStore(input.guildId);
  const permId = `${input.targetType}:${input.targetId}`;
  const perm = store.permissions.get(permId);

  if (!perm || !perm.active) {
    return { revoked: false };
  }

  const now = new Date().toISOString();
  perm.active = false;
  perm.revokedAt = now;
  perm.revokedById = input.actorId;

  await discordStorage.saveRecord(input.guildId, 'PERMISSION', permId, perm);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: input.actorId,
    actorName: input.actorName,
    entityType: 'permission',
    entityId: `${input.targetType}:${input.targetId}`,
    action: 'deadline_permission_revoked',
    details: {
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
    },
  });

  return { revoked: true };
}

export interface AuthorisedUserView {
  id: number | string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  grantedById: string;
  createdAt: string;
}

export interface AuthorisedRoleView {
  id: number | string;
  roleId: string;
  roleName: string;
  color: number;
  grantedById: string;
  createdAt: string;
}

export async function listDeadlinePermissions(guildId: string) {
  const store = discordStorage.getStore(guildId);
  const settingsRow = store.settings;

  const perms = [...store.permissions.values()]
    .filter((p) => p.guildId === guildId && p.active)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const authorisedUsers: AuthorisedUserView[] = perms
    .filter((p) => p.targetType === 'user')
    .map((p) => {
      const u = store.users.get(p.targetId);
      return {
        id: p.id,
        userId: p.targetId,
        username: u?.username ?? p.targetId,
        displayName: u?.displayName ?? p.targetId,
        avatarUrl: u?.avatarUrl ?? null,
        grantedById: p.grantedById,
        createdAt: p.createdAt,
      };
    });

  const authorisedRoles: AuthorisedRoleView[] = perms
    .filter((p) => p.targetType === 'role')
    .map((p) => {
      const r = store.roles.get(p.targetId);
      return {
        id: p.id,
        roleId: p.targetId,
        roleName: r?.name ?? p.targetId,
        color: r?.color ?? 0,
        grantedById: p.grantedById,
        createdAt: p.createdAt,
      };
    });

  const history = [...store.auditLogs.values()]
    .filter((log) => log.guildId === guildId && log.entityType === 'permission')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  const owner = settingsRow ? store.users.get(settingsRow.ownerId) : null;

  return {
    guildOwner: settingsRow
      ? {
          id: settingsRow.ownerId,
          username: owner?.username ?? settingsRow.ownerId,
          displayName: owner?.displayName ?? 'Server Owner',
          avatarUrl: owner?.avatarUrl ?? null,
        }
      : null,
    authorisedUsers,
    authorisedRoles,
    history,
  };
}
