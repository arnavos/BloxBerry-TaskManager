import type { Guild, GuildMember, Interaction, User } from 'discord.js';
import type { PermissionContext } from '../domain/types.js';
import { buildPermissionContext } from '../services/permissionService.js';
import { syncDiscordUser, syncGuildMetadata } from '../services/userService.js';

export async function resolveInteractionContext(
  interaction: Interaction
): Promise<{
  guild: Guild;
  member: GuildMember | null;
  user: User;
  actorName: string;
  ctx: PermissionContext;
}> {
  if (!interaction.guild) {
    throw new Error('This command can only be used inside the Bloxberry Labs Discord server.');
  }

  const guild = interaction.guild;
  const user = interaction.user;
  let member: GuildMember | null = null;

  if (interaction.member && 'roles' in interaction.member && 'cache' in interaction.member.roles) {
    member = interaction.member as GuildMember;
  } else {
    member = await guild.members.fetch(user.id).catch(() => null);
  }

  await syncGuildMetadata(guild);
  await syncDiscordUser(user, member);

  const roleIds = member
    ? member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id)
    : [];

  const ctx = await buildPermissionContext({
    guildId: guild.id,
    userId: user.id,
    roleIds,
    guildOwnerId: guild.ownerId,
  });

  const actorName = member?.displayName ?? user.globalName ?? user.username;
  return { guild, member, user, actorName, ctx };
}

export async function syncTargetMember(guild: Guild, targetUser: User): Promise<void> {
  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  await syncDiscordUser(targetUser, member);
}
