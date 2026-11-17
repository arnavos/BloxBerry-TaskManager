import { describe, expect, it } from 'vitest';
import {
  canCompleteTask,
  canEditOrDeleteTask,
  canManageDeadlines,
  canModifyDeadlinePermissions,
  canViewStaffTasks,
} from '../src/domain/permissions.js';
import type { PermissionContext } from '../src/domain/types.js';

function makeCtx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: 'user-1',
    guildId: 'guild-1',
    guildOwnerId: 'owner-1',
    roleIds: [],
    authorisedUserIds: new Set<string>(),
    authorisedRoleIds: new Set<string>(),
    ...overrides,
  };
}

describe('Permission Evaluators', () => {
  it('allows ONLY the Discord server owner to modify deadline permissions', () => {
    const ownerCtx = makeCtx({ userId: 'owner-1' });
    const managerCtx = makeCtx({
      userId: 'mgr-1',
      authorisedUserIds: new Set(['mgr-1']),
      authorisedRoleIds: new Set(['role-lead']),
      roleIds: ['role-lead'],
    });
    const ordinaryCtx = makeCtx({ userId: 'staff-1' });

    expect(canModifyDeadlinePermissions(ownerCtx)).toBe(true);
    expect(canModifyDeadlinePermissions(managerCtx)).toBe(false);
    expect(canModifyDeadlinePermissions(ordinaryCtx)).toBe(false);
  });

  it('grants deadline management to owner, authorised users, and authorised roles', () => {
    expect(canManageDeadlines(makeCtx({ userId: 'owner-1' }))).toBe(true);
    expect(
      canManageDeadlines(makeCtx({ userId: 'u2', authorisedUserIds: new Set(['u2']) }))
    ).toBe(true);
    expect(
      canManageDeadlines(
        makeCtx({
          userId: 'u3',
          roleIds: ['role-mod'],
          authorisedRoleIds: new Set(['role-mod']),
        })
      )
    ).toBe(true);
    expect(canManageDeadlines(makeCtx({ userId: 'u4', roleIds: ['role-member'] }))).toBe(false);
  });

  it('prevents ordinary members from completing someone else’s task', () => {
    const staffCtx = makeCtx({ userId: 'staff-a' });
    expect(canCompleteTask(staffCtx, { assigneeId: 'staff-a' })).toBe(true);
    expect(canCompleteTask(staffCtx, { assigneeId: 'staff-b' })).toBe(false);

    const managerCtx = makeCtx({
      userId: 'mgr-1',
      authorisedUserIds: new Set(['mgr-1']),
    });
    expect(canCompleteTask(managerCtx, { assigneeId: 'staff-b' })).toBe(true);
  });

  it('allows creator or authorised management to edit or delete tasks, not random staff', () => {
    const creatorCtx = makeCtx({ userId: 'creator-1' });
    const randomCtx = makeCtx({ userId: 'random-2' });
    const managerCtx = makeCtx({
      userId: 'mgr-1',
      roleIds: ['role-admin'],
      authorisedRoleIds: new Set(['role-admin']),
    });

    expect(canEditOrDeleteTask(creatorCtx, { creatorId: 'creator-1' })).toBe(true);
    expect(canEditOrDeleteTask(randomCtx, { creatorId: 'creator-1' })).toBe(false);
    expect(canEditOrDeleteTask(managerCtx, { creatorId: 'creator-1' })).toBe(true);
  });

  it('restricts viewing another staff member tasks to authorised management or self', () => {
    const staffCtx = makeCtx({ userId: 'staff-1' });
    expect(canViewStaffTasks(staffCtx, 'staff-1')).toBe(true);
    expect(canViewStaffTasks(staffCtx, 'staff-2')).toBe(false);

    const managerCtx = makeCtx({ userId: 'mgr-1', authorisedUserIds: new Set(['mgr-1']) });
    expect(canViewStaffTasks(managerCtx, 'staff-2')).toBe(true);
  });
});
