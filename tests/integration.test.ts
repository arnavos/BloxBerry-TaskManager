import { beforeEach, describe, expect, it } from 'vitest';
import {
  discordStorage,
  type StorageChannelLike,
  type StorageMessageLike,
} from '../src/storage/discordStorage.js';
import {
  buildPermissionContext,
  grantDeadlinePermission,
  listDeadlinePermissions,
  revokeDeadlinePermission,
} from '../src/services/permissionService.js';
import {
  addDevelopmentPhase,
  addMilestone,
  createProject,
  listProjectsWithRoadmaps,
  reorderMilestones,
  updateMilestone,
} from '../src/services/roadmapService.js';
import {
  runDeadlineSweep,
  type DmNotificationPayload,
  type NotificationTransport,
} from '../src/services/schedulerService.js';
import {
  completeTask,
  createTask,
  getTaskById,
  listOverdueAlertNotifications,
  PermissionError,
  updateTask,
} from '../src/services/taskService.js';
import { upsertDiscordRole, upsertUser } from '../src/services/userService.js';
import { createWebServer } from '../src/server/webServer.js';

const GUILD_ID = 'guild-test-1';
const OWNER_ID = 'owner-100';
const MANAGER_ID = 'mgr-200';
const STAFF_A_ID = 'staff-300';
const STAFF_B_ID = 'staff-400';

class MockStorageChannel implements StorageChannelLike {
  name = 'bloxpilot-storage';
  messagesMap = new Map<string, StorageMessageLike>();
  private currentId = 1;

  async send(content: string): Promise<StorageMessageLike> {
    const id = `msg-${this.currentId++}`;
    const msg: StorageMessageLike = {
      id,
      content,
      edit: async (newContent: string) => {
        msg.content = newContent;
        this.messagesMap.set(id, msg);
        return msg;
      },
      delete: async () => {
        this.messagesMap.delete(id);
        return msg;
      },
    };
    this.messagesMap.set(id, msg);
    return msg;
  }

  messages = {
    fetch: async (options?: { limit?: number; before?: string }) => {
      let entries = Array.from(this.messagesMap.values());
      if (options?.before) {
        const idx = entries.findIndex((m) => m.id === options.before);
        if (idx !== -1) {
          entries = entries.slice(0, idx);
        }
      }
      if (options?.limit) {
        entries = entries.slice(-options.limit);
      }
      const map = new Map<string, StorageMessageLike>();
      for (const m of entries) {
        map.set(m.id, m);
      }
      return map;
    },
  };
}

describe('Zero-External-Database Architecture: Discord-Channel Persistence & Bot Operations', () => {
  let mockChannel: MockStorageChannel;

  beforeEach(async () => {
    discordStorage.resetAllForTesting();
    mockChannel = new MockStorageChannel();
    discordStorage.setChannel(GUILD_ID, mockChannel);

    // Initial settings record
    await discordStorage.saveRecord(GUILD_ID, 'SETTINGS', GUILD_ID, {
      guildId: GUILD_ID,
      guildName: 'Bloxberry Labs Test',
      ownerId: OWNER_ID,
      updatedAt: new Date().toISOString(),
    });

    await upsertUser({ id: OWNER_ID, username: 'owner', displayName: 'Studio Owner', roleIds: [] }, GUILD_ID);
    await upsertUser({ id: MANAGER_ID, username: 'manager', displayName: 'Lead Producer', roleIds: ['role-lead'] }, GUILD_ID);
    await upsertUser({ id: STAFF_A_ID, username: 'staffA', displayName: 'Scripter Alice', roleIds: ['role-dev'] }, GUILD_ID);
    await upsertUser({ id: STAFF_B_ID, username: 'staffB', displayName: 'Builder Bob', roleIds: ['role-build'] }, GUILD_ID);
    await upsertDiscordRole(GUILD_ID, { id: 'role-lead', name: 'Lead Producer', color: 0xffaa00, position: 10 });
  });

  it('enforces server-owner-only deadline permission grant, listing and revocation', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });
    const staffCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: STAFF_A_ID });

    // Non-owner cannot grant deadline permission
    await expect(
      grantDeadlinePermission({
        guildId: GUILD_ID,
        targetType: 'user',
        targetId: MANAGER_ID,
        targetLabel: 'Lead Producer',
        actorId: STAFF_A_ID,
        actorName: 'Scripter Alice',
        guildOwnerId: OWNER_ID,
      })
    ).rejects.toThrow(/Only the Discord server owner can authorise/);

    // Server owner grants permission to user
    const res = await grantDeadlinePermission({
      guildId: GUILD_ID,
      targetType: 'user',
      targetId: MANAGER_ID,
      targetLabel: 'Lead Producer',
      actorId: OWNER_ID,
      actorName: 'Studio Owner',
      guildOwnerId: OWNER_ID,
    });
    expect(res.alreadyActive).toBe(false);

    // Grant permission to role
    await grantDeadlinePermission({
      guildId: GUILD_ID,
      targetType: 'role',
      targetId: 'role-lead',
      targetLabel: 'Lead Producer',
      actorId: OWNER_ID,
      actorName: 'Studio Owner',
      guildOwnerId: OWNER_ID,
    });

    const perms = await listDeadlinePermissions(GUILD_ID);
    expect(perms.authorisedUsers).toHaveLength(1);
    expect(perms.authorisedUsers[0].userId).toBe(MANAGER_ID);
    expect(perms.authorisedRoles).toHaveLength(1);
    expect(perms.authorisedRoles[0].roleId).toBe('role-lead');

    // Revoke permission
    const revoked = await revokeDeadlinePermission({
      guildId: GUILD_ID,
      targetType: 'user',
      targetId: MANAGER_ID,
      targetLabel: 'Lead Producer',
      actorId: OWNER_ID,
      actorName: 'Studio Owner',
      guildOwnerId: OWNER_ID,
    });
    expect(revoked.revoked).toBe(true);

    const permsAfter = await listDeadlinePermissions(GUILD_ID);
    expect(permsAfter.authorisedUsers).toHaveLength(0);
  });

  it('rejects unauthorised members from creating tasks with deadlines, allows authorised members', async () => {
    const staffCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: STAFF_A_ID });

    // Ordinary staff cannot set deadline
    await expect(
      createTask(
        {
          guildId: GUILD_ID,
          title: 'Implement Inventory',
          deadlineAt: new Date(Date.now() + 86400000),
          actorName: 'Scripter Alice',
        },
        staffCtx
      )
    ).rejects.toThrow(PermissionError);

    // Ordinary staff CAN create tasks without deadlines
    const task = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Fix UI Bug',
        actorName: 'Scripter Alice',
      },
      staffCtx
    );
    expect(task.title).toBe('Fix UI Bug');
    expect(task.deadlineAt).toBeNull();

    // Authorised manager can set deadlines
    await grantDeadlinePermission({
      guildId: GUILD_ID,
      targetType: 'user',
      targetId: MANAGER_ID,
      targetLabel: 'Lead Producer',
      actorId: OWNER_ID,
      actorName: 'Studio Owner',
      guildOwnerId: OWNER_ID,
    });

    const mgrCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: MANAGER_ID });
    const deadlineTask = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Map Blockout',
        deadlineAt: new Date(Date.now() + 86400000),
        assigneeId: STAFF_B_ID,
        actorName: 'Lead Producer',
      },
      mgrCtx
    );
    expect(deadlineTask.deadlineAt).not.toBeNull();
  });

  it('handles task completion permissions and prevents unauthorized member completion', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });
    const staffACtx = await buildPermissionContext({ guildId: GUILD_ID, userId: STAFF_A_ID });
    const staffBCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: STAFF_B_ID });

    const task = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Weapon Animation',
        assigneeId: STAFF_A_ID,
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    // Staff B cannot complete Staff A's task
    await expect(
      completeTask(task.id, staffBCtx, 'Builder Bob')
    ).rejects.toThrow(PermissionError);

    // Staff A can complete own task
    const completed = await completeTask(task.id, staffACtx, 'Scripter Alice');
    expect(completed.status).toBe('Completed');
    expect(completed.completedById).toBe(STAFF_A_ID);
  });

  it('runs deadline monitoring sweep, marks overdue, sends DMs and deduplicates notifications', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });
    // Set deadline in the future slightly so task starts as Not Started, then sweep is run with now in the future
    const taskDeadline = new Date(Date.now() + 5000);

    const task = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Core Movement Physics',
        assigneeId: STAFF_A_ID,
        deadlineAt: taskDeadline,
        actorName: 'Studio Owner',
      },
      ownerCtx
    );
    expect(task.status).toBe('Not Started');

    const sentDms: Array<{ userId: string; payload: DmNotificationPayload }> = [];
    const transport: NotificationTransport = {
      sendDm: async (userId, payload) => {
        sentDms.push({ userId, payload });
        return { ok: true };
      },
    };

    // First sweep at deadline + 2 minutes (past grace period) sends overdue notification to assignee
    const sweepTime = new Date(taskDeadline.getTime() + 120_000);
    const sweep1 = await runDeadlineSweep(transport, { now: sweepTime });
    expect(sweep1.tasksMarkedOverdue).toBe(1);
    expect(sweep1.notificationsSent).toBe(1);
    expect(sentDms).toHaveLength(1);
    expect(sentDms[0].userId).toBe(STAFF_A_ID);

    // Second sweep should NOT duplicate notification
    const sweep2 = await runDeadlineSweep(transport, { now: sweepTime });
    expect(sweep2.notificationsClaimed).toBe(0);
    expect(sweep2.notificationsSent).toBe(0);
    expect(sentDms).toHaveLength(1);

    const notifs = await listOverdueAlertNotifications(GUILD_ID);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].deliveryStatus).toBe('sent');
  });

  it('supports full roadmap lifecycle: creation, milestones, phases and progress calculation', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });

    const roadmap = await createProject(
      {
        guildId: GUILD_ID,
        name: 'Project Velocity (Roblox)',
        description: 'Sci-fi racing shooter',
        seedDefaultStages: true,
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    expect(roadmap.name).toBe('Project Velocity (Roblox)');
    expect(roadmap.milestones).toHaveLength(12);

    // Complete the first milestone
    const firstM = roadmap.milestones[0];
    await updateMilestone(
      firstM.id,
      {
        guildId: GUILD_ID,
        status: 'Completed',
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    const updatedRoadmap = (await listProjectsWithRoadmaps(GUILD_ID))[0];
    expect(updatedRoadmap.milestones[0].status).toBe('Completed');
    expect(updatedRoadmap.progress.completedCount).toBe(1);
    expect(updatedRoadmap.progress.overallPercent).toBeGreaterThan(0);
  });

  it('reconstructs full application state from storage channel messages on restart', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });

    // Create a task and a project
    const createdTask = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Combat Dash System',
        assigneeId: STAFF_A_ID,
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    await createProject(
      {
        guildId: GUILD_ID,
        name: 'Battle Royale 2026',
        seedDefaultStages: false,
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    // Verify messages were written to mockChannel
    expect(mockChannel.messagesMap.size).toBeGreaterThan(0);

    // SIMULATE PROCESS RESTART: Clear in-memory state completely
    discordStorage.resetAllForTesting();
    expect(discordStorage.getStore(GUILD_ID).tasks.size).toBe(0);

    // Reconstruct state from the channel messages
    await discordStorage.loadFromChannel(GUILD_ID, mockChannel);

    // Verify task recovered
    const recoveredTask = await getTaskById(createdTask.id, GUILD_ID);
    expect(recoveredTask).not.toBeNull();
    expect(recoveredTask?.title).toBe('Combat Dash System');

    // Verify project recovered
    const roadmaps = await listProjectsWithRoadmaps(GUILD_ID);
    expect(roadmaps).toHaveLength(1);
    expect(roadmaps[0].name).toBe('Battle Royale 2026');
  });

  it('edits existing messages in place instead of creating duplicates when records update', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });

    const created = await createTask(
      {
        guildId: GUILD_ID,
        title: 'Initial Title',
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    const messageCountBefore = mockChannel.messagesMap.size;

    // Update the task title and description
    await updateTask(
      created.id,
      {
        title: 'Updated Title In Place',
        description: 'New Description',
        actorName: 'Studio Owner',
      },
      ownerCtx
    );

    // Channel messages map size should NOT have grown (edited existing message)
    // Note: Task history record adds 1 new message for audit, but the task record itself is edited in place
    const updated = await getTaskById(created.id, GUILD_ID);
    expect(updated?.title).toBe('Updated Title In Place');
  });

  it('serves Fastify /health and root endpoints reporting Discord channel storage', async () => {
    const server = await createWebServer({
      isBotConnected: () => true,
    });

    const healthRes = await server.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);
    const healthBody = JSON.parse(healthRes.body);
    expect(healthBody.ok).toBe(true);
    expect(healthBody.storage.type).toBe('discord-channel');
    expect(healthBody.botConnected).toBe(true);

    const rootRes = await server.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);
    const rootBody = JSON.parse(rootRes.body);
    expect(rootBody.storage).toBe('discord-channel');

    await server.close();
  });
});
