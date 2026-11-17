import type { MilestoneStatus } from './types.js';

export const DEFAULT_ROBLOX_STAGES: ReadonlyArray<{
  title: string;
  description: string;
}> = [
  {
    title: 'Game Concept & Planning',
    description: 'Core game loop, target audience, scope, monetization, and GDD sign-off.',
  },
  {
    title: 'Pre-Production',
    description: 'Technical architecture, greybox prototypes, and art direction benchmarks.',
  },
  {
    title: 'Core Gameplay Development',
    description: 'Primary player mechanics, combat/interaction loops, and server-authoritative logic.',
  },
  {
    title: 'Map & Environment Development',
    description: 'World layout, terrain, lighting, landmarks, and traversal validation.',
  },
  {
    title: 'UI/UX Development',
    description: 'HUD, menus, inventory, shop interfaces, and responsive scaling across devices.',
  },
  {
    title: 'Systems & Backend Development',
    description: 'DataStore persistence, economy, analytics, matchmaking, and anti-exploit guards.',
  },
  {
    title: 'Art, Animation & VFX',
    description: '3D assets, character rigs, animations, particles, and visual polish.',
  },
  {
    title: 'Audio & Sound Design',
    description: 'SFX banks, spatial audio, UI feedback, and dynamic music integration.',
  },
  {
    title: 'Testing & QA',
    description: 'Regression sweeps, edge-case testing, multiplayer stress checks, and bug triage.',
  },
  {
    title: 'Optimisation',
    description: 'Client FPS profiling, streaming, memory budget tuning, and network replication cleanup.',
  },
  {
    title: 'Beta Testing',
    description: 'Closed/open playtests, telemetry review, balance tuning, and feedback fixes.',
  },
  {
    title: 'Final Release',
    description: 'Launch checklist, store metadata, live-ops readiness, and production rollout.',
  },
];

export interface MilestoneProgressInput {
  id: number;
  title: string;
  status: MilestoneStatus | string;
  progressPercent: number;
  sortOrder: number;
}

export interface ProjectProgressSummary {
  overallPercent: number;
  totalMilestones: number;
  completedCount: number;
  inProgressCount: number;
  planningCount: number;
  blockedCount: number;
  notStartedCount: number;
  currentMilestone: MilestoneProgressInput | null;
}

export function calculateProjectProgress(
  milestones: ReadonlyArray<MilestoneProgressInput>
): ProjectProgressSummary {
  if (milestones.length === 0) {
    return {
      overallPercent: 0,
      totalMilestones: 0,
      completedCount: 0,
      inProgressCount: 0,
      planningCount: 0,
      blockedCount: 0,
      notStartedCount: 0,
      currentMilestone: null,
    };
  }

  const ordered = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder);

  let totalScore = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let planningCount = 0;
  let blockedCount = 0;
  let notStartedCount = 0;

  for (const m of ordered) {
    if (m.status === 'Completed') {
      completedCount++;
      totalScore += 100;
    } else {
      const clamped = Math.max(0, Math.min(100, m.progressPercent ?? 0));
      totalScore += clamped;
      if (m.status === 'In Progress') inProgressCount++;
      else if (m.status === 'Planning') planningCount++;
      else if (m.status === 'Blocked') blockedCount++;
      else notStartedCount++;
    }
  }

  const currentMilestone =
    ordered.find((m) => m.status === 'In Progress') ??
    ordered.find((m) => m.status === 'Blocked') ??
    ordered.find((m) => m.status === 'Planning') ??
    ordered.find((m) => m.status !== 'Completed') ??
    ordered[ordered.length - 1] ??
    null;

  return {
    overallPercent: Math.round(totalScore / ordered.length),
    totalMilestones: ordered.length,
    completedCount,
    inProgressCount,
    planningCount,
    blockedCount,
    notStartedCount,
    currentMilestone,
  };
}

export function renderProgressBar(percent: number, width: number = 14): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${clamped}%`;
}
