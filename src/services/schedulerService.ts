import { formatInTimezone, formatTaskCountdown } from '../domain/countdown.js';
import type { NotificationType } from '../domain/types.js';
import { recordAuditLog } from './auditService.js';
import {
  discordStorage,
  type DeadlineNotificationData,
  type TaskHistoryData,
} from '../storage/discordStorage.js';

export interface DmNotificationPayload {
  taskId: number;
  guildId: string;
  title: string;
  priority: string;
  projectCategory: string;
  deadlineFormatted: string;
  countdownLabel: string;
  notificationType: NotificationType;
  assigneeName: string;
}

export interface NotificationTransport {
  sendDm(userId: string, payload: DmNotificationPayload): Promise<{ ok: boolean; error?: string }>;
}

interface ClaimedDelivery {
  notificationKey: string;
  notificationData: DeadlineNotificationData;
  taskId: number;
  guildId: string;
  recipientId: string;
  notificationType: NotificationType;
  payload: DmNotificationPayload;
}

export interface SweepSummary {
  tasksMarkedOverdue: number;
  notificationsClaimed: number;
  notificationsSent: number;
  notificationsFailed: number;
}

export async function runDeadlineSweep(
  transport: NotificationTransport,
  options: {
    now?: Date;
    managementDelayMinutes?: number;
  } = {}
): Promise<SweepSummary> {
  const now = options.now ?? new Date();
  const managementDelayMs = (options.managementDelayMinutes ?? 120) * 60_000;
  const overdueGraceMs = 60_000; // 1 minute grace before escalating from due_now -> overdue

  let tasksMarkedOverdue = 0;
  const claimedDeliveries: ClaimedDelivery[] = [];

  const guildIds = discordStorage.getAllGuildIds();

  for (const guildId of guildIds) {
    const store = discordStorage.getStore(guildId);
    const ownerId = store.settings?.ownerId;

    // Load authorised management users (explicitly authorised users + users holding authorised roles)
    const mgmtRecipients = new Set<string>();
    if (ownerId) mgmtRecipients.add(ownerId);

    const authRoleIds = new Set<string>();
    for (const p of store.permissions.values()) {
      if (p.guildId !== guildId || !p.active) continue;
      if (p.targetType === 'user') mgmtRecipients.add(p.targetId);
      else if (p.targetType === 'role') authRoleIds.add(p.targetId);
    }

    if (authRoleIds.size > 0) {
      for (const u of store.users.values()) {
        if (u.roleIds && u.roleIds.some((rid) => authRoleIds.has(rid))) {
          mgmtRecipients.add(u.id);
        }
      }
    }

    const dueTasks = [...store.tasks.values()].filter(
      (t) =>
        t.guildId === guildId &&
        t.deadlineAt !== null &&
        new Date(t.deadlineAt).getTime() <= now.getTime() &&
        t.status !== 'Completed' &&
        t.status !== 'On Hold'
    );

    for (const task of dueTasks) {
      const deadlineDate = new Date(task.deadlineAt!);
      const elapsedMs = now.getTime() - deadlineDate.getTime();
      const tz = task.timezone || 'Asia/Kolkata';
      const deadlineFormatted = formatInTimezone(deadlineDate, tz);
      const assignee = task.assigneeId ? store.users.get(task.assigneeId) : undefined;
      const assigneeName = assignee?.displayName ?? assignee?.username ?? 'Unassigned';

      // Transition status to Overdue once past grace
      if (elapsedMs >= overdueGraceMs && task.status !== 'Overdue') {
        const previousStatus = task.status;
        task.status = 'Overdue';
        task.updatedAt = now.toISOString();
        await discordStorage.saveRecord(guildId, 'TASK', task.id, task);

        const historyId = `${task.id}_${now.getTime()}`;
        const historyData: TaskHistoryData = {
          id: historyId,
          taskId: task.id,
          actorId: task.assigneeId ?? ownerId ?? 'system',
          action: 'marked_overdue',
          previousStatus,
          newStatus: 'Overdue',
          changes: { deadlineAt: deadlineDate.toISOString() },
          createdAt: now.toISOString(),
        };
        await discordStorage.saveRecord(guildId, 'HISTORY', historyId, historyData);

        await recordAuditLog({
          guildId,
          actorId: 'system',
          actorName: 'Deadline Scheduler',
          entityType: 'deadline',
          entityId: task.id,
          action: 'task_marked_overdue',
          details: { title: task.title, previousStatus },
        });

        tasksMarkedOverdue++;
      }

      const countdown = formatTaskCountdown(
        { status: elapsedMs >= overdueGraceMs ? 'Overdue' : (task.status as any), deadlineAt: deadlineDate },
        now
      );

      // 1. Due-now reminder or Overdue notification to assignee
      if (task.assigneeId) {
        const notifType: NotificationType =
          elapsedMs < overdueGraceMs ? 'due_now' : 'overdue_assignee';
        const notifKey = `${task.id}_${notifType}_${task.assigneeId}`;

        if (!store.notifications.has(notifKey)) {
          const notifData: DeadlineNotificationData = {
            id: notifKey,
            taskId: task.id,
            recipientId: task.assigneeId,
            notificationType: notifType,
            deliveryStatus: 'pending',
            errorMessage: null,
            sentAt: null,
            createdAt: now.toISOString(),
          };
          await discordStorage.saveRecord(guildId, 'NOTIFICATION', notifKey, notifData);

          claimedDeliveries.push({
            notificationKey: notifKey,
            notificationData: notifData,
            taskId: task.id,
            guildId,
            recipientId: task.assigneeId,
            notificationType: notifType,
            payload: {
              taskId: task.id,
              guildId,
              title: task.title,
              priority: task.priority,
              projectCategory: task.projectCategory,
              deadlineFormatted,
              countdownLabel: countdown.label,
              notificationType: notifType,
              assigneeName,
            },
          });
        }
      }

      // 2. Escalation notification to authorised management if task remains overdue
      if (elapsedMs >= managementDelayMs) {
        for (const managerId of mgmtRecipients) {
          if (managerId === task.assigneeId) continue; // Already notified as assignee
          const notifKey = `${task.id}_overdue_management_${managerId}`;

          if (!store.notifications.has(notifKey)) {
            const notifData: DeadlineNotificationData = {
              id: notifKey,
              taskId: task.id,
              recipientId: managerId,
              notificationType: 'overdue_management',
              deliveryStatus: 'pending',
              errorMessage: null,
              sentAt: null,
              createdAt: now.toISOString(),
            };
            await discordStorage.saveRecord(guildId, 'NOTIFICATION', notifKey, notifData);

            claimedDeliveries.push({
              notificationKey: notifKey,
              notificationData: notifData,
              taskId: task.id,
              guildId,
              recipientId: managerId,
              notificationType: 'overdue_management',
              payload: {
                taskId: task.id,
                guildId,
                title: task.title,
                priority: task.priority,
                projectCategory: task.projectCategory,
                deadlineFormatted,
                countdownLabel: countdown.label,
                notificationType: 'overdue_management',
                assigneeName,
              },
            });
          }
        }
      }
    }
  }

  let notificationsSent = 0;
  let notificationsFailed = 0;

  for (const delivery of claimedDeliveries) {
    const result = await transport.sendDm(delivery.recipientId, delivery.payload);
    const store = discordStorage.getStore(delivery.guildId);
    if (result.ok) {
      delivery.notificationData.deliveryStatus = 'sent';
      delivery.notificationData.sentAt = new Date().toISOString();
      await discordStorage.saveRecord(
        delivery.guildId,
        'NOTIFICATION',
        delivery.notificationKey,
        delivery.notificationData
      );
      notificationsSent++;
    } else {
      delivery.notificationData.deliveryStatus = 'failed_dm_disabled';
      delivery.notificationData.errorMessage = result.error ?? 'Failed to send DM';
      await discordStorage.saveRecord(
        delivery.guildId,
        'NOTIFICATION',
        delivery.notificationKey,
        delivery.notificationData
      );

      const user = store.users.get(delivery.recipientId);
      if (user) {
        user.dmDisabled = true;
        user.updatedAt = new Date().toISOString();
        await discordStorage.saveRecord(delivery.guildId, 'USER', user.id, user);
      }

      await recordAuditLog({
        guildId: delivery.guildId,
        actorId: 'system',
        actorName: 'Deadline Scheduler',
        entityType: 'deadline',
        entityId: delivery.taskId,
        action: 'dm_delivery_failed',
        details: {
          recipientId: delivery.recipientId,
          notificationType: delivery.notificationType,
          error: result.error ?? 'DM disabled or blocked',
        },
      });
      notificationsFailed++;
    }
  }

  return {
    tasksMarkedOverdue,
    notificationsClaimed: claimedDeliveries.length,
    notificationsSent,
    notificationsFailed,
  };
}

export class DeadlineScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly transport: NotificationTransport,
    private readonly intervalMs: number,
    private readonly managementDelayMinutes: number
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    // Run initial recovery sweep shortly after boot
    setTimeout(() => {
      void this.tick();
    }, 3_000).unref();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
    console.log(`[Scheduler] Started deadline monitor (interval=${this.intervalMs}ms)`);
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const summary = await runDeadlineSweep(this.transport, {
        managementDelayMinutes: this.managementDelayMinutes,
      });
      if (
        summary.tasksMarkedOverdue > 0 ||
        summary.notificationsSent > 0 ||
        summary.notificationsFailed > 0
      ) {
        console.log(
          `[Scheduler] Sweep complete: overdue=${summary.tasksMarkedOverdue}, sent=${summary.notificationsSent}, failed=${summary.notificationsFailed}`
        );
      }
    } catch (err) {
      console.error('[Scheduler] Sweep error:', err instanceof Error ? err.message : err);
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Scheduler] Stopped.');
    }
  }
}
