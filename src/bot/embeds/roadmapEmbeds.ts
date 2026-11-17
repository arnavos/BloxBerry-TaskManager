import { EmbedBuilder } from 'discord.js';
import { renderProgressBar } from '../../domain/roadmap.js';
import { formatInTimezone } from '../../domain/countdown.js';
import type { MilestoneView, ProjectRoadmapView } from '../../services/roadmapService.js';
import { BRAND_COLOR, DANGER_COLOR, INFO_COLOR, SUCCESS_COLOR, WARNING_COLOR } from './taskEmbeds.js';

export function milestoneStatusEmoji(status: string): string {
  switch (status) {
    case 'Completed':
      return '✅';
    case 'In Progress':
      return '🚀';
    case 'Planning':
      return '📝';
    case 'Blocked':
      return '⛔';
    default:
      return '⬜';
  }
}

export function buildRoadmapEmbed(project: ProjectRoadmapView): EmbedBuilder {
  const { progress } = project;
  const bar = renderProgressBar(progress.overallPercent, 16);

  const completedList = project.milestones.filter((m) => m.status === 'Completed');
  const upcomingList = project.milestones.filter(
    (m) => m.status !== 'Completed' && m.id !== progress.currentMilestone?.id
  );

  const color =
    progress.overallPercent === 100
      ? SUCCESS_COLOR
      : progress.blockedCount > 0
        ? WARNING_COLOR
        : BRAND_COLOR;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🗺️ ${project.name} — Development Roadmap`)
    .setDescription(
      [
        project.description || '*Bloxberry Labs Roblox game production lifecycle.*',
        '',
        `**Overall Progress:** \`${bar}\``,
        `✅ Completed: **${progress.completedCount}/${progress.totalMilestones}** • 🚀 In Progress: **${progress.inProgressCount}** • ⛔ Blocked: **${progress.blockedCount}**`,
      ].join('\n')
    )
    .setFooter({ text: `Project ID #${project.id} • Bloxberry Labs Roadmap` })
    .setTimestamp();

  if (progress.currentMilestone) {
    const cm = progress.currentMilestone;
    const cmFull = project.milestones.find((m) => m.id === cm.id);
    embed.addFields({
      name: '🎯 Current Focus Milestone',
      value: [
        `${milestoneStatusEmoji(cm.status)} **#${cm.id} Stage ${cm.sortOrder}: ${cm.title}** (${cm.status} — ${cm.progressPercent}%)`,
        cmFull?.ownerId ? `Owner: <@${cmFull.ownerId}>` : 'Owner: Unassigned',
        cmFull?.deadlineAt ? `Deadline: ${formatInTimezone(cmFull.deadlineAt)}` : '',
      ]
        .filter(Boolean)
        .join(' • '),
      inline: false,
    });
  }

  const stageLines = project.milestones.slice(0, 15).map((m) => {
    const ownerText = m.ownerId ? `<@${m.ownerId}>` : 'Unassigned';
    return `${milestoneStatusEmoji(m.status)} **${m.sortOrder}.** \`#${m.id}\` **${m.title}** — ${m.status} (${m.progressPercent}%) • ${ownerText}`;
  });

  if (stageLines.length > 0) {
    embed.addFields({
      name: '📍 Roadmap Stages',
      value: stageLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (completedList.length > 0) {
    embed.addFields({
      name: `✅ Completed (${completedList.length})`,
      value: completedList.map((m) => `• ${m.title}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }

  if (upcomingList.length > 0) {
    embed.addFields({
      name: `⏳ Upcoming (${upcomingList.length})`,
      value: upcomingList
        .slice(0, 6)
        .map((m) => `• ${m.sortOrder}. ${m.title}`)
        .join('\n')
        .slice(0, 1024),
      inline: true,
    });
  }

  return embed;
}

export function buildMilestoneDetailEmbed(
  milestone: MilestoneView,
  projectName: string
): EmbedBuilder {
  const color =
    milestone.status === 'Completed'
      ? SUCCESS_COLOR
      : milestone.status === 'Blocked'
        ? DANGER_COLOR
        : milestone.status === 'In Progress'
          ? INFO_COLOR
          : BRAND_COLOR;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${milestoneStatusEmoji(milestone.status)} Stage ${milestone.sortOrder}: ${milestone.title}`)
    .setDescription(milestone.description || '*No description provided.*')
    .addFields(
      { name: 'Project', value: projectName, inline: true },
      { name: 'Status', value: `**${milestone.status}**`, inline: true },
      { name: 'Progress', value: `\`${renderProgressBar(milestone.progressPercent, 10)}\``, inline: true },
      {
        name: 'Owner',
        value: milestone.ownerId ? `<@${milestone.ownerId}>` : 'Unassigned',
        inline: true,
      },
      {
        name: 'Linked Tasks',
        value: `${milestone.completedTaskCount}/${milestone.linkedTaskCount} completed`,
        inline: true,
      },
      {
        name: 'Deadline (IST)',
        value: milestone.deadlineAt ? formatInTimezone(milestone.deadlineAt) : 'Not set',
        inline: true,
      }
    )
    .setFooter({ text: `Milestone ID #${milestone.id} • Project #${milestone.projectId}` })
    .setTimestamp();

  if (milestone.phases.length > 0) {
    embed.addFields({
      name: `🧩 Development Phases (${milestone.phases.length})`,
      value: milestone.phases
        .map(
          (p) =>
            `${milestoneStatusEmoji(p.status)} **${p.sortOrder}. ${p.title}** — ${p.status}`
        )
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}
