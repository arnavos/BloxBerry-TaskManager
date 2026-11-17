import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { parseDeadlineInput } from '../../domain/countdown.js';
import { canManageDeadlines, canModifyDeadlinePermissions } from '../../domain/permissions.js';
import {
  grantDeadlinePermission,
  listDeadlinePermissions,
  revokeDeadlinePermission,
} from '../../services/permissionService.js';
import { updateTask } from '../../services/taskService.js';
import { upsertDiscordRole } from '../../services/userService.js';
import { resolveInteractionContext, syncTargetMember } from '../context.js';
import { buildTaskCardComponents, buildTaskCardEmbed, BRAND_COLOR, SUCCESS_COLOR, WARNING_COLOR } from '../embeds/taskEmbeds.js';
import type { BotCommand } from './index.js';

export const deadlineCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('deadline-set')
      .setDescription('Set a deadline on an existing task (Authorised users only)')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName('deadline')
          .setDescription('Deadline in Asia/Kolkata (e.g. "2026-11-25 18:00", "in 4 hours", "3d")')
          .setRequired(true)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content:
            '⛔ **Permission Denied:** Only the Discord server owner or owner-authorised users/roles can set deadlines.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const env = getEnv();
      const taskId = interaction.options.getInteger('task_id', true);
      const rawDeadline = interaction.options.getString('deadline', true);

      let parsed: ReturnType<typeof parseDeadlineInput>;
      try {
        parsed = parseDeadlineInput(rawDeadline, env.DEFAULT_TIMEZONE);
      } catch (err) {
        await interaction.reply({
          content: `❌ ${err instanceof Error ? err.message : 'Invalid deadline format.'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const updated = await updateTask(
          taskId,
          { deadlineAt: parsed.date, actorName },
          ctx
        );
        await interaction.reply({
          content: `📅 Deadline set for **Task #${updated.id}**: **${parsed.formatted}**`,
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Failed to set deadline.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deadline-edit')
      .setDescription('Update an existing task deadline (Authorised users only)')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName('deadline')
          .setDescription('New deadline (e.g. "2026-11-28 20:00", "tomorrow 18:00", "2d")')
          .setRequired(true)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content: '⛔ **Permission Denied:** You are not authorised to edit deadlines.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const env = getEnv();
      const taskId = interaction.options.getInteger('task_id', true);
      const rawDeadline = interaction.options.getString('deadline', true);

      let parsed: ReturnType<typeof parseDeadlineInput>;
      try {
        parsed = parseDeadlineInput(rawDeadline, env.DEFAULT_TIMEZONE);
      } catch (err) {
        await interaction.reply({
          content: `❌ ${err instanceof Error ? err.message : 'Invalid deadline format.'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const updated = await updateTask(
          taskId,
          { deadlineAt: parsed.date, actorName },
          ctx
        );
        await interaction.reply({
          content: `📅 Updated deadline for **Task #${updated.id}** to **${parsed.formatted}**`,
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Failed to update deadline.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deadline-remove')
      .setDescription('Remove the deadline from a task (Authorised users only)')
      .addIntegerOption((opt) =>
        opt.setName('task_id').setDescription('Task ID').setRequired(true).setMinValue(1)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { ctx, actorName } = await resolveInteractionContext(interaction);
      if (!canManageDeadlines(ctx)) {
        await interaction.reply({
          content: '⛔ **Permission Denied:** You are not authorised to remove deadlines.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const taskId = interaction.options.getInteger('task_id', true);
      try {
        const updated = await updateTask(
          taskId,
          { clearDeadline: true, actorName },
          ctx
        );
        await interaction.reply({
          content: `🗑️ Removed deadline from **Task #${updated.id}**.`,
          embeds: [buildTaskCardEmbed(updated)],
          components: buildTaskCardComponents(updated),
        });
      } catch (err) {
        await interaction.reply({
          content: `⛔ ${err instanceof Error ? err.message : 'Failed to remove deadline.'}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deadline-authorise')
      .setDescription('Authorise a Discord user or role to assign deadlines (Server Owner ONLY)')
      .addSubcommand((sub) =>
        sub
          .setName('user')
          .setDescription('Authorise an individual Discord user')
          .addUserOption((opt) =>
            opt.setName('user').setDescription('User to authorise').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('role')
          .setDescription('Authorise a Discord role')
          .addRoleOption((opt) =>
            opt.setName('role').setDescription('Role to authorise').setRequired(true)
          )
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);

      if (!canModifyDeadlinePermissions(ctx)) {
        await interaction.reply({
          content:
            '🔒 **Server Owner Only:** Only the actual Discord server owner can authorise deadline permissions.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const sub = interaction.options.getSubcommand(true);
      if (sub === 'user') {
        const target = interaction.options.getUser('user', true);
        await syncTargetMember(guild, target);
        const res = await grantDeadlinePermission({
          guildId: guild.id,
          targetType: 'user',
          targetId: target.id,
          targetLabel: target.username,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await interaction.reply({
          content: res.alreadyActive
            ? `ℹ️ <@${target.id}> is already authorised to assign deadlines.`
            : `✅ Authorised <@${target.id}> to assign and manage deadlines.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'role') {
        const role = interaction.options.getRole('role', true);
        await upsertDiscordRole(guild.id, {
          id: role.id,
          name: role.name,
          color: role.color,
          position: 'position' in role ? role.position : 0,
        });
        const res = await grantDeadlinePermission({
          guildId: guild.id,
          targetType: 'role',
          targetId: role.id,
          targetLabel: role.name,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await interaction.reply({
          content: res.alreadyActive
            ? `ℹ️ Role <@&${role.id}> is already authorised to assign deadlines.`
            : `✅ Authorised role <@&${role.id}> to assign and manage deadlines.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deadline-revoke')
      .setDescription('Revoke deadline assignment permissions (Server Owner ONLY)')
      .addSubcommand((sub) =>
        sub
          .setName('user')
          .setDescription('Revoke deadline permission from a user')
          .addUserOption((opt) =>
            opt.setName('user').setDescription('User to revoke').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('role')
          .setDescription('Revoke deadline permission from a role')
          .addRoleOption((opt) =>
            opt.setName('role').setDescription('Role to revoke').setRequired(true)
          )
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild, ctx, actorName } = await resolveInteractionContext(interaction);

      if (!canModifyDeadlinePermissions(ctx)) {
        await interaction.reply({
          content:
            '🔒 **Server Owner Only:** Only the actual Discord server owner can revoke deadline permissions.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const sub = interaction.options.getSubcommand(true);
      if (sub === 'user') {
        const target = interaction.options.getUser('user', true);
        const res = await revokeDeadlinePermission({
          guildId: guild.id,
          targetType: 'user',
          targetId: target.id,
          targetLabel: target.username,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await interaction.reply({
          content: res.revoked
            ? `🛑 Revoked deadline permission from <@${target.id}>.`
            : `ℹ️ <@${target.id}> did not have an active user-level deadline authorisation.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'role') {
        const role = interaction.options.getRole('role', true);
        const res = await revokeDeadlinePermission({
          guildId: guild.id,
          targetType: 'role',
          targetId: role.id,
          targetLabel: role.name,
          actorId: ctx.userId,
          actorName,
          guildOwnerId: guild.ownerId,
        });
        await interaction.reply({
          content: res.revoked
            ? `🛑 Revoked deadline permission from role <@&${role.id}>.`
            : `ℹ️ Role <@&${role.id}> did not have an active deadline authorisation.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deadline-permissions')
      .setDescription('View all users and roles authorised to assign deadlines'),
    async execute(interaction: ChatInputCommandInteraction) {
      const { guild } = await resolveInteractionContext(interaction);
      const perms = await listDeadlinePermissions(guild.id);

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🔐 Deadline Assignment Permissions')
        .setDescription(
          `Only the Discord server owner (<@${guild.ownerId}>) can modify these authorisations.`
        )
        .addFields(
          {
            name: `👤 Authorised Users (${perms.authorisedUsers.length})`,
            value:
              perms.authorisedUsers.length > 0
                ? perms.authorisedUsers.map((u) => `• <@${u.userId}> (\`${u.displayName}\`)`).join('\n')
                : '*No individual users authorised.*',
            inline: false,
          },
          {
            name: `🏷️ Authorised Roles (${perms.authorisedRoles.length})`,
            value:
              perms.authorisedRoles.length > 0
                ? perms.authorisedRoles.map((r) => `• <@&${r.roleId}> (\`${r.roleName}\`)`).join('\n')
                : '*No roles authorised.*',
            inline: false,
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
];
