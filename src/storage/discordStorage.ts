import {
  ChannelType,
  Collection,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Message,
  type TextChannel,
} from 'discord.js';

export const STORAGE_CHANNEL_NAME = 'bloxpilot-storage';

export interface StorageMessageLike {
  id: string;
  content: string;
  edit(content: string): Promise<StorageMessageLike>;
  delete(): Promise<StorageMessageLike | unknown>;
}

export interface StorageChannelLike {
  name: string;
  send(content: string): Promise<StorageMessageLike>;
  messages: {
    fetch(options?: {
      limit?: number;
      before?: string;
    }): Promise<Map<string, StorageMessageLike> | Collection<string, StorageMessageLike>>;
  };
}

export type RecordType =
  | 'SETTINGS'
  | 'USER'
  | 'ROLE'
  | 'TASK'
  | 'HISTORY'
  | 'PERMISSION'
  | 'NOTIFICATION'
  | 'PROJECT'
  | 'MILESTONE'
  | 'PHASE'
  | 'AUDIT';

export interface BloxRecord<T = unknown> {
  type: RecordType;
  key: string;
  data: T;
  messageId?: string;
}

export interface GuildSettingsData {
  guildId: string;
  guildName: string;
  ownerId: string;
  updatedAt: string;

  // Customization: Branding
  workspaceName?: string;
  botDisplayName?: string;
  logoUrl?: string | null;
  embedColor?: number;
  welcomeMessage?: string;
  footerText?: string;

  // Customization: Task Configuration
  taskCategories?: string[];
  taskPriorities?: string[];
  taskStatuses?: string[];
  defaultPriority?: string;

  // Customization: Deadline & Notifications
  defaultTimezone?: string;
  reminderIntervalMs?: number;
  overdueEscalationMinutes?: number;

  // Customization: Active Project
  activeProjectId?: number | null;
}

export interface UserData {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isStaff: boolean;
  roleIds: string[];
  dmDisabled: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleData {
  id: string;
  guildId: string;
  name: string;
  color: number;
  position: number;
  updatedAt: string;
}

export interface TaskData {
  id: number;
  guildId: string;
  title: string;
  description: string;
  projectCategory: string;
  priority: string;
  status: string;
  creatorId: string;
  assigneeId: string | null;
  completedById: string | null;
  deadlineAt: string | null;
  timezone: string;
  completedAt: string | null;
  milestoneId: number | null;
  phaseId: number | null;
  discordMessageId: string | null;
  discordChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskHistoryData {
  id: number | string;
  taskId: number;
  actorId: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  changes: Record<string, unknown>;
  createdAt: string;
}

export interface DeadlinePermissionData {
  id: number | string;
  guildId: string;
  targetType: 'user' | 'role';
  targetId: string;
  grantedById: string;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
  revokedById: string | null;
}

export interface DeadlineNotificationData {
  id: number | string;
  taskId: number;
  recipientId: string;
  notificationType: string;
  deliveryStatus: string;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ProjectData {
  id: number;
  guildId: string;
  name: string;
  description: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneData {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: string;
  ownerId: string | null;
  sortOrder: number;
  startDate: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
}

export type DevelopmentPhaseData = PhaseData;
export interface PhaseData {
  id: number;
  milestoneId: number;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAssignmentData {
  id: string;
  taskId: number;
  userId: string;
  assignedById: string;
  assignedAt: string;
}

export interface AuditLogData {
  id: number | string;
  guildId: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export function formatRecordMessage(type: RecordType, key: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `[BLOX:${type}:${key}]\n\`\`\`json\n${json}\n\`\`\``;
}

export function parseRecordMessage(content: string): BloxRecord | null {
  const match = content.match(/^\[BLOX:([A-Z_]+):([^\]\n]+)\]\s*\n```json\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const type = match[1] as RecordType;
    const key = match[2];
    const data = JSON.parse(match[3]);
    return { type, key, data };
  } catch {
    return null;
  }
}

export class GuildStorageStore {
  settings: GuildSettingsData | null = null;
  users = new Map<string, UserData>();
  roles = new Map<string, RoleData>();
  tasks = new Map<number, TaskData>();
  taskHistory: TaskHistoryData[] = [];
  permissions = new Map<string, DeadlinePermissionData>();
  notifications = new Map<string, DeadlineNotificationData>(); // key: `${taskId}:${type}:${recipientId}`
  projects = new Map<number, ProjectData>();
  milestones = new Map<number, MilestoneData>();
  phases = new Map<number, DevelopmentPhaseData>();
  auditLogs: AuditLogData[] = [];

  // Mapping from composite record key `${type}:${key}` to Discord message ID
  messageIdMap = new Map<string, string>();

  // ID generators
  nextTaskId = 1;
  nextHistoryId = 1;
  nextPermId = 1;
  nextNotifId = 1;
  nextProjectId = 1;
  nextMilestoneId = 1;
  nextPhaseId = 1;
  nextAuditId = 1;

  getNextTaskId(): number {
    return this.nextTaskId++;
  }
  getNextHistoryId(): number {
    return this.nextHistoryId++;
  }
  getNextPermId(): number {
    return this.nextPermId++;
  }
  getNextNotifId(): number {
    return this.nextNotifId++;
  }
  getNextProjectId(): number {
    return this.nextProjectId++;
  }
  getNextMilestoneId(): number {
    return this.nextMilestoneId++;
  }
  getNextPhaseId(): number {
    return this.nextPhaseId++;
  }
  getNextAuditId(): number {
    return this.nextAuditId++;
  }

  syncNextIds(): void {
    for (const id of this.tasks.keys()) if (id >= this.nextTaskId) this.nextTaskId = id + 1;
    for (const h of this.taskHistory) {
      const numId = Number(h.id);
      if (!isNaN(numId) && numId >= this.nextHistoryId) this.nextHistoryId = numId + 1;
    }
    for (const p of this.permissions.values()) {
      const numId = Number(p.id);
      if (!isNaN(numId) && numId >= this.nextPermId) this.nextPermId = numId + 1;
    }
    for (const n of this.notifications.values()) {
      const numId = Number(n.id);
      if (!isNaN(numId) && numId >= this.nextNotifId) this.nextNotifId = numId + 1;
    }
    for (const pr of this.projects.keys()) if (pr >= this.nextProjectId) this.nextProjectId = pr + 1;
    for (const m of this.milestones.keys()) if (m >= this.nextMilestoneId) this.nextMilestoneId = m + 1;
    for (const ph of this.phases.keys()) if (ph >= this.nextPhaseId) this.nextPhaseId = ph + 1;
    for (const a of this.auditLogs) {
      const numId = Number(a.id);
      if (!isNaN(numId) && numId >= this.nextAuditId) this.nextAuditId = numId + 1;
    }
  }
}

export class DiscordStorageManager {
  private stores = new Map<string, GuildStorageStore>();
  private channels = new Map<string, StorageChannelLike>();
  private writeQueues = new Map<string, Promise<unknown>>();
  private initializedGuilds = new Set<string>();

  getStore(guildId: string): GuildStorageStore {
    let store = this.stores.get(guildId);
    if (!store) {
      store = new GuildStorageStore();
      this.stores.set(guildId, store);
    }
    return store;
  }

  setChannel(guildId: string, channel: StorageChannelLike): void {
    this.channels.set(guildId, channel);
  }

  getChannel(guildId: string): StorageChannelLike | null {
    return this.channels.get(guildId) ?? null;
  }

  isInitialized(guildId: string): boolean {
    return this.initializedGuilds.has(guildId);
  }

  async ensureStorageChannel(guild: Guild, clientUser: Client['user']): Promise<TextChannel> {
    const existing = guild.channels.cache.find(
      (c) => c.name === STORAGE_CHANNEL_NAME && c.type === ChannelType.GuildText
    ) as TextChannel | undefined;

    if (existing) {
      this.setChannel(guild.id, existing as unknown as StorageChannelLike);
      return existing;
    }

    const overwrites: Array<{
      id: string;
      type?: OverwriteType;
      allow?: bigint[];
      deny?: bigint[];
    }> = [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: guild.ownerId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      },
    ];

    if (clientUser) {
      overwrites.push({
        id: clientUser.id,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: STORAGE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: 'Bloxberry Labs internal persistent storage — managed automatically by the bot.',
      permissionOverwrites: overwrites,
    });

    this.setChannel(guild.id, channel as unknown as StorageChannelLike);
    console.log(`[Storage] Created private storage channel #${STORAGE_CHANNEL_NAME} in guild ${guild.id}.`);
    return channel;
  }

  async loadFromChannel(guildId: string, channel: StorageChannelLike): Promise<void> {
    const store = this.getStore(guildId);
    console.log(`[Storage] Reconstructing state from #${channel.name} in guild ${guildId}...`);

    let before: string | undefined;
    let totalMessages = 0;
    let parsedCount = 0;

    while (true) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (!batch || batch.size === 0) break;

      totalMessages += batch.size;
      const values = Array.from(batch.values());

      for (const msg of values) {
        const record = parseRecordMessage(msg.content);
        if (!record) continue;

        parsedCount++;
        const mapKey = `${record.type}:${record.key}`;
        store.messageIdMap.set(mapKey, msg.id);

        switch (record.type) {
          case 'SETTINGS':
            store.settings = record.data as GuildSettingsData;
            break;
          case 'USER':
            store.users.set(record.key, record.data as UserData);
            break;
          case 'ROLE':
            store.roles.set(record.key, record.data as RoleData);
            break;
          case 'TASK':
            store.tasks.set(Number(record.key), record.data as TaskData);
            break;
          case 'HISTORY':
            store.taskHistory.push(record.data as TaskHistoryData);
            break;
          case 'PERMISSION':
            store.permissions.set(record.key, record.data as DeadlinePermissionData);
            break;
          case 'NOTIFICATION':
            store.notifications.set(record.key, record.data as DeadlineNotificationData);
            break;
          case 'PROJECT':
            store.projects.set(Number(record.key), record.data as ProjectData);
            break;
          case 'MILESTONE':
            store.milestones.set(Number(record.key), record.data as MilestoneData);
            break;
          case 'PHASE':
            store.phases.set(Number(record.key), record.data as DevelopmentPhaseData);
            break;
          case 'AUDIT':
            store.auditLogs.push(record.data as AuditLogData);
            break;
        }
      }

      if (batch.size < 100) break;
      const last = values[values.length - 1];
      before = last.id;
    }

    store.syncNextIds();
    this.initializedGuilds.add(guildId);
    console.log(
      `[Storage] State reconstructed for guild ${guildId}: ${parsedCount} records from ${totalMessages} messages.`
    );
  }

  // Sequential queue execution per guild to prevent message edit/create race conditions
  private enqueueWrite<T>(guildId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(guildId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        return await op();
      });

    this.writeQueues.set(guildId, next);
    return next;
  }

  async saveRecord<T>(
    guildId: string,
    type: RecordType,
    key: string | number,
    data: T
  ): Promise<void> {
    const stringKey = String(key);
    const store = this.getStore(guildId);
    const channel = this.getChannel(guildId);
    const mapKey = `${type}:${stringKey}`;

    // Apply update to in-memory store immediately
    this.applyInMemory(store, type, stringKey, data);

    if (!channel) {
      // In tests or if storage channel isn't bound yet
      return;
    }

    await this.enqueueWrite(guildId, async () => {
      const content = formatRecordMessage(type, stringKey, data);
      const existingMsgId = store.messageIdMap.get(mapKey);

      if (existingMsgId) {
        try {
          const fetchedMap = await channel.messages.fetch({ limit: 100 });
          const msg = fetchedMap.get(existingMsgId);

          if (msg && typeof msg.edit === 'function') {
            await msg.edit(content);
            return;
          }
        } catch {
          // If message was deleted manually, post a new one
        }
      }

      const sent = await channel.send(content);
      store.messageIdMap.set(mapKey, sent.id);
    });
  }

  async deleteRecord(guildId: string, type: RecordType, key: string | number): Promise<void> {
    const stringKey = String(key);
    const store = this.getStore(guildId);
    const channel = this.getChannel(guildId);
    const mapKey = `${type}:${stringKey}`;

    // Remove from in-memory store
    this.removeInMemory(store, type, stringKey);

    const existingMsgId = store.messageIdMap.get(mapKey);
    store.messageIdMap.delete(mapKey);

    if (!channel || !existingMsgId) return;

    await this.enqueueWrite(guildId, async () => {
      try {
        const batch = await channel.messages.fetch({ limit: 100 });
        const msg = batch.get(existingMsgId);
        if (msg && typeof msg.delete === 'function') {
          await msg.delete();
        }
      } catch {
        // Ignore if already deleted
      }
    });
  }

  private applyInMemory(store: GuildStorageStore, type: RecordType, key: string, data: unknown): void {
    switch (type) {
      case 'SETTINGS':
        store.settings = data as GuildSettingsData;
        break;
      case 'USER':
        store.users.set(key, data as UserData);
        break;
      case 'ROLE':
        store.roles.set(key, data as RoleData);
        break;
      case 'TASK':
        store.tasks.set(Number(key), data as TaskData);
        break;
      case 'HISTORY':
        store.taskHistory.push(data as TaskHistoryData);
        break;
      case 'PERMISSION':
        store.permissions.set(key, data as DeadlinePermissionData);
        break;
      case 'NOTIFICATION':
        store.notifications.set(key, data as DeadlineNotificationData);
        break;
      case 'PROJECT':
        store.projects.set(Number(key), data as ProjectData);
        break;
      case 'MILESTONE':
        store.milestones.set(Number(key), data as MilestoneData);
        break;
      case 'PHASE':
        store.phases.set(Number(key), data as DevelopmentPhaseData);
        break;
      case 'AUDIT':
        store.auditLogs.push(data as AuditLogData);
        break;
    }
  }

  private removeInMemory(store: GuildStorageStore, type: RecordType, key: string): void {
    switch (type) {
      case 'TASK':
        store.tasks.delete(Number(key));
        break;
      case 'PERMISSION':
        store.permissions.delete(key);
        break;
      case 'PROJECT':
        store.projects.delete(Number(key));
        break;
      case 'MILESTONE':
        store.milestones.delete(Number(key));
        break;
      case 'PHASE':
        store.phases.delete(Number(key));
        break;
    }
  }

  resetAllForTesting(): void {
    this.stores.clear();
    this.channels.clear();
    this.writeQueues.clear();
    this.initializedGuilds.clear();
  }

  getAllGuildIds(): string[] {
    return Array.from(this.stores.keys());
  }
}

export const discordStorage = new DiscordStorageManager();
