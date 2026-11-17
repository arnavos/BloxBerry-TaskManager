import type { Guild, GuildMember, Role, User } from 'discord.js';
import { discordStorage, type RoleData, type UserData } from '../storage/discordStorage.js';

export interface UpsertUserInput {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  roleIds?: string[];
  isStaff?: boolean;
}

export async function upsertUser(
  input: UpsertUserInput,
  guildId?: string
): Promise<void> {
  const now = new Date().toISOString();
  const targetGuildIds = guildId ? [guildId] : discordStorage.getAllGuildIds();

  // If no guilds registered yet in memory, fallback to empty loop
  for (const gid of targetGuildIds) {
    const store = discordStorage.getStore(gid);
    const existing = store.users.get(input.id);
    const userData: UserData = {
      id: input.id,
      username: input.username,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing?.avatarUrl ?? null,
      roleIds: input.roleIds !== undefined ? input.roleIds : existing?.roleIds ?? [],
      isStaff: input.isStaff !== undefined ? input.isStaff : existing?.isStaff ?? true,
      dmDisabled: existing?.dmDisabled ?? false,
      lastSeenAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await discordStorage.saveRecord(gid, 'USER', input.id, userData);
  }
}

export async function syncDiscordUser(
  discordUser: User,
  member?: GuildMember | null,
  guildId?: string
): Promise<void> {
  const roleIds = member
    ? member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.id)
    : undefined;

  const targetGuildId = guildId ?? member?.guild.id;

  await upsertUser(
    {
      id: discordUser.id,
      username: discordUser.username,
      displayName: member?.displayName ?? discordUser.globalName ?? discordUser.username,
      avatarUrl: discordUser.displayAvatarURL({ size: 128 }),
      roleIds,
      isStaff: !discordUser.bot,
    },
    targetGuildId
  );
}

export async function syncGuildMetadata(guild: Guild): Promise<void> {
  const now = new Date().toISOString();
  await discordStorage.saveRecord(guild.id, 'SETTINGS', guild.id, {
    guildId: guild.id,
    guildName: guild.name,
    ownerId: guild.ownerId,
    updatedAt: now,
  });

  // Sync roles
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id);
  for (const role of roles) {
    await upsertDiscordRole(guild.id, role);
  }
}

export async function upsertDiscordRole(
  guildId: string,
  role: Pick<Role, 'id' | 'name' | 'color' | 'position'>
): Promise<void> {
  const roleData: RoleData = {
    id: role.id,
    guildId,
    name: role.name,
    color: role.color,
    position: role.position,
    updatedAt: new Date().toISOString(),
  };
  await discordStorage.saveRecord(guildId, 'ROLE', role.id, roleData);
}

export async function getGuildOwnerId(
  guildId: string
): Promise<string | null> {
  const store = discordStorage.getStore(guildId);
  return store.settings?.ownerId ?? null;
}

export async function getUserById(userId: string, guildId?: string): Promise<UserData | null> {
  if (guildId) {
    return discordStorage.getStore(guildId).users.get(userId) ?? null;
  }
  for (const gid of discordStorage.getAllGuildIds()) {
    const user = discordStorage.getStore(gid).users.get(userId);
    if (user) return user;
  }
  return null;
}
