import { canManageRoadmap } from '../domain/permissions.js';
import {
  calculateProjectProgress,
  DEFAULT_ROBLOX_STAGES,
  type ProjectProgressSummary,
} from '../domain/roadmap.js';
import type { MilestoneStatus, PermissionContext, PhaseStatus } from '../domain/types.js';
import { recordAuditLog } from './auditService.js';
import { NotFoundError, PermissionError } from './taskService.js';
import {
  discordStorage,
  type MilestoneData,
  type PhaseData,
  type ProjectData,
} from '../storage/discordStorage.js';

export interface PhaseView {
  id: number;
  milestoneId: number;
  title: string;
  description: string;
  status: PhaseStatus;
  sortOrder: number;
}

export interface MilestoneView {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: MilestoneStatus;
  ownerId: string | null;
  ownerName: string | null;
  sortOrder: number;
  startDate: Date | null;
  deadlineAt: Date | null;
  completedAt: Date | null;
  progressPercent: number;
  phases: PhaseView[];
  linkedTaskCount: number;
  completedTaskCount: number;
}

export interface ProjectRoadmapView {
  id: number;
  guildId: string;
  name: string;
  description: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  progress: ProjectProgressSummary;
  milestones: MilestoneView[];
}

export async function createProject(
  input: {
    guildId: string;
    name: string;
    description?: string;
    seedDefaultStages?: boolean;
    actorName: string;
  },
  ctx: PermissionContext
): Promise<ProjectRoadmapView> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError(
      'Only authorised management members or the server owner can create roadmap projects.'
    );
  }

  const store = discordStorage.getStore(input.guildId);
  store.nextProjectId += 1;
  const projectId = store.nextProjectId;
  const now = new Date();

  const projData: ProjectData = {
    id: projectId,
    guildId: input.guildId,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    createdById: ctx.userId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await discordStorage.saveRecord(input.guildId, 'PROJECT', projectId, projData);

  if (input.seedDefaultStages !== false) {
    for (let idx = 0; idx < DEFAULT_ROBLOX_STAGES.length; idx++) {
      const stage = DEFAULT_ROBLOX_STAGES[idx];
      store.nextMilestoneId += 1;
      const mId = store.nextMilestoneId;
      const mData: MilestoneData = {
        id: mId,
        projectId,
        title: stage.title,
        description: stage.description,
        status: idx === 0 ? 'Planning' : 'Not Started',
        ownerId: null,
        sortOrder: idx + 1,
        startDate: null,
        deadlineAt: null,
        completedAt: null,
        progressPercent: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await discordStorage.saveRecord(input.guildId, 'MILESTONE', mId, mData);
    }
  }

  await recordAuditLog({
    guildId: input.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: 'roadmap',
    entityId: projectId,
    action: 'project_created',
    details: {
      name: projData.name,
      seededDefaultStages: input.seedDefaultStages !== false,
    },
  });

  const view = await getProjectRoadmapById(projectId, input.guildId);
  return view!;
}

export async function addMilestone(
  input: {
    guildId: string;
    projectId: number;
    title: string;
    description?: string;
    ownerId?: string | null;
    status?: MilestoneStatus;
    deadlineAt?: Date | null;
    startDate?: Date | null;
    progressPercent?: number;
    sortOrder?: number;
    actorName: string;
  },
  ctx: PermissionContext
): Promise<MilestoneView> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can add roadmap milestones.');
  }

  const store = discordStorage.getStore(input.guildId);
  const proj = store.projects.get(input.projectId);

  if (!proj || proj.guildId !== input.guildId) {
    throw new NotFoundError(`Project #${input.projectId} not found.`);
  }

  const existing = [...store.milestones.values()].filter((m) => m.projectId === input.projectId);
  const nextOrder =
    input.sortOrder ??
    (existing.length > 0 ? Math.max(...existing.map((m) => m.sortOrder)) + 1 : 1);

  const now = new Date();
  const status = input.status ?? 'Not Started';
  const progress =
    status === 'Completed' ? 100 : Math.max(0, Math.min(100, input.progressPercent ?? 0));

  store.nextMilestoneId += 1;
  const milestoneId = store.nextMilestoneId;

  const milestoneData: MilestoneData = {
    id: milestoneId,
    projectId: input.projectId,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    status,
    ownerId: input.ownerId ?? null,
    sortOrder: nextOrder,
    startDate: input.startDate ? input.startDate.toISOString() : null,
    deadlineAt: input.deadlineAt ? input.deadlineAt.toISOString() : null,
    completedAt: status === 'Completed' ? now.toISOString() : null,
    progressPercent: progress,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await discordStorage.saveRecord(input.guildId, 'MILESTONE', milestoneId, milestoneData);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: 'milestone',
    entityId: milestoneId,
    action: 'milestone_added',
    details: { projectId: input.projectId, title: milestoneData.title, sortOrder: nextOrder },
  });

  const full = await getProjectRoadmapById(input.projectId, input.guildId);
  return full!.milestones.find((m) => m.id === milestoneId)!;
}

export async function updateMilestone(
  milestoneId: number,
  input: {
    guildId: string;
    title?: string;
    description?: string;
    status?: MilestoneStatus;
    ownerId?: string | null;
    deadlineAt?: Date | null;
    clearDeadline?: boolean;
    startDate?: Date | null;
    progressPercent?: number;
    sortOrder?: number;
    actorName: string;
  },
  ctx: PermissionContext
): Promise<MilestoneView> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can update roadmap milestones.');
  }

  const store = discordStorage.getStore(input.guildId);
  const m = store.milestones.get(milestoneId);

  if (!m) {
    throw new NotFoundError(`Milestone #${milestoneId} not found.`);
  }

  const proj = store.projects.get(m.projectId);
  if (!proj || proj.guildId !== input.guildId) {
    throw new NotFoundError(`Milestone #${milestoneId} not found.`);
  }

  const now = new Date();
  const nextStatus = input.status ?? (m.status as MilestoneStatus);
  let nextProgress =
    input.progressPercent !== undefined
      ? Math.max(0, Math.min(100, input.progressPercent))
      : m.progressPercent;

  if (nextStatus === 'Completed') nextProgress = 100;
  else if (input.status && input.status !== 'Completed' && m.status === 'Completed' && input.progressPercent === undefined) {
    nextProgress = 50;
  }

  const nextCompletedAt =
    nextStatus === 'Completed' ? m.completedAt ?? now.toISOString() : null;

  if (input.title !== undefined) m.title = input.title.trim();
  if (input.description !== undefined) m.description = input.description.trim();
  m.status = nextStatus;
  if (input.ownerId !== undefined) m.ownerId = input.ownerId;
  if (input.startDate !== undefined) m.startDate = input.startDate ? input.startDate.toISOString() : null;
  if (input.clearDeadline) m.deadlineAt = null;
  else if (input.deadlineAt !== undefined) m.deadlineAt = input.deadlineAt ? input.deadlineAt.toISOString() : null;
  if (input.sortOrder !== undefined) m.sortOrder = input.sortOrder;
  m.completedAt = nextCompletedAt;
  m.progressPercent = nextProgress;
  m.updatedAt = now.toISOString();

  await discordStorage.saveRecord(input.guildId, 'MILESTONE', milestoneId, m);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: 'milestone',
    entityId: milestoneId,
    action: 'milestone_updated',
    details: {
      title: input.title ?? m.title,
      previousStatus: m.status,
      newStatus: nextStatus,
      progressPercent: nextProgress,
    },
  });

  const full = await getProjectRoadmapById(m.projectId, input.guildId);
  return full!.milestones.find((item) => item.id === milestoneId)!;
}

export async function reorderMilestones(
  projectId: number,
  orderedMilestoneIds: number[],
  ctx: PermissionContext,
  actorName: string
): Promise<ProjectRoadmapView> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can reorder roadmap stages.');
  }

  const store = discordStorage.getStore(ctx.guildId);
  const proj = store.projects.get(projectId);
  if (!proj || proj.guildId !== ctx.guildId) throw new NotFoundError(`Project #${projectId} not found.`);

  const now = new Date().toISOString();
  for (let i = 0; i < orderedMilestoneIds.length; i++) {
    const mId = orderedMilestoneIds[i];
    const m = store.milestones.get(mId);
    if (m && m.projectId === projectId) {
      m.sortOrder = i + 1;
      m.updatedAt = now;
      await discordStorage.saveRecord(ctx.guildId, 'MILESTONE', mId, m);
    }
  }

  await recordAuditLog({
    guildId: ctx.guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'roadmap',
    entityId: projectId,
    action: 'milestones_reordered',
    details: { orderedMilestoneIds },
  });

  return (await getProjectRoadmapById(projectId, ctx.guildId))!;
}

export async function addDevelopmentPhase(
  input: {
    guildId: string;
    milestoneId: number;
    title: string;
    description?: string;
    status?: PhaseStatus;
    actorName: string;
  },
  ctx: PermissionContext
) {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can add development phases.');
  }

  const store = discordStorage.getStore(input.guildId);
  const milestone = store.milestones.get(input.milestoneId);
  if (!milestone) {
    throw new NotFoundError(`Milestone #${input.milestoneId} not found.`);
  }

  const proj = store.projects.get(milestone.projectId);
  if (!proj || proj.guildId !== input.guildId) {
    throw new NotFoundError(`Milestone #${input.milestoneId} not found.`);
  }

  const existingPhases = [...store.phases.values()].filter((p) => p.milestoneId === input.milestoneId);
  const nextOrder =
    existingPhases.length > 0 ? Math.max(...existingPhases.map((p) => p.sortOrder)) + 1 : 1;

  store.nextPhaseId += 1;
  const phaseId = store.nextPhaseId;

  const phaseData: PhaseData = {
    id: phaseId,
    milestoneId: input.milestoneId,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    status: input.status ?? 'Not Started',
    sortOrder: nextOrder,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await discordStorage.saveRecord(input.guildId, 'PHASE', phaseId, phaseData);

  await recordAuditLog({
    guildId: input.guildId,
    actorId: ctx.userId,
    actorName: input.actorName,
    entityType: 'phase',
    entityId: phaseId,
    action: 'phase_added',
    details: { milestoneId: input.milestoneId, title: phaseData.title },
  });

  return phaseData;
}

export async function deleteMilestone(
  milestoneId: number,
  guildId: string,
  ctx: PermissionContext,
  actorName: string
): Promise<{ title: string; projectId: number }> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can delete roadmap milestones.');
  }

  const store = discordStorage.getStore(guildId);
  const m = store.milestones.get(milestoneId);
  if (!m) {
    throw new NotFoundError(`Milestone #${milestoneId} not found.`);
  }

  const proj = store.projects.get(m.projectId);
  if (!proj || proj.guildId !== guildId) {
    throw new NotFoundError(`Milestone #${milestoneId} not found.`);
  }

  // Delete attached phases and unlink tasks
  for (const [pId, ph] of store.phases.entries()) {
    if (ph.milestoneId === milestoneId) {
      await discordStorage.deleteRecord(guildId, 'PHASE', pId);
    }
  }

  for (const task of store.tasks.values()) {
    if (task.milestoneId === milestoneId) {
      task.milestoneId = null;
      task.updatedAt = new Date().toISOString();
      await discordStorage.saveRecord(guildId, 'TASK', task.id, task);
    }
  }

  await discordStorage.deleteRecord(guildId, 'MILESTONE', milestoneId);

  await recordAuditLog({
    guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'milestone',
    entityId: milestoneId,
    action: 'milestone_deleted',
    details: { title: m.title, projectId: m.projectId },
  });

  return { title: m.title, projectId: m.projectId };
}

export async function deleteProject(
  projectId: number,
  guildId: string,
  ctx: PermissionContext,
  actorName: string
): Promise<{ name: string }> {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can delete roadmap projects.');
  }

  const store = discordStorage.getStore(guildId);
  const proj = store.projects.get(projectId);
  if (!proj || proj.guildId !== guildId) {
    throw new NotFoundError(`Project #${projectId} not found.`);
  }

  // Delete milestones and unlink tasks
  for (const [mId, m] of store.milestones.entries()) {
    if (m.projectId === projectId) {
      await deleteMilestone(mId, guildId, ctx, actorName);
    }
  }

  await discordStorage.deleteRecord(guildId, 'PROJECT', projectId);

  await recordAuditLog({
    guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'roadmap',
    entityId: projectId,
    action: 'project_deleted',
    details: { name: proj.name },
  });

  return { name: proj.name };
}

export async function updateDevelopmentPhaseStatus(
  phaseId: number,
  status: PhaseStatus,
  ctx: PermissionContext,
  actorName: string
) {
  if (!canManageRoadmap(ctx)) {
    throw new PermissionError('Only authorised management members can update development phases.');
  }

  const store = discordStorage.getStore(ctx.guildId);
  const phase = store.phases.get(phaseId);
  if (!phase) throw new NotFoundError(`Phase #${phaseId} not found.`);

  const milestone = store.milestones.get(phase.milestoneId);
  if (!milestone) throw new NotFoundError(`Milestone #${phase.milestoneId} not found.`);

  const proj = store.projects.get(milestone.projectId);
  if (!proj || proj.guildId !== ctx.guildId) throw new NotFoundError(`Phase #${phaseId} not found.`);

  phase.status = status;
  phase.updatedAt = new Date().toISOString();

  await discordStorage.saveRecord(ctx.guildId, 'PHASE', phaseId, phase);

  await recordAuditLog({
    guildId: ctx.guildId,
    actorId: ctx.userId,
    actorName,
    entityType: 'phase',
    entityId: phaseId,
    action: 'phase_updated',
    details: { title: phase.title, status },
  });

  return phase;
}

export async function getProjectRoadmapById(
  projectId: number,
  guildId: string
): Promise<ProjectRoadmapView | null> {
  const all = await listProjectsWithRoadmaps(guildId);
  return all.find((p) => p.id === projectId) ?? null;
}

export async function listProjectsWithRoadmaps(
  guildId: string
): Promise<ProjectRoadmapView[]> {
  const store = discordStorage.getStore(guildId);
  const projectRows = [...store.projects.values()]
    .filter((p) => p.guildId === guildId)
    .sort((a, b) => a.id - b.id);

  if (projectRows.length === 0) return [];

  const allMilestones = [...store.milestones.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const allPhases = [...store.phases.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const guildTasks = [...store.tasks.values()].filter((t) => t.guildId === guildId);

  const phasesByMilestone = new Map<number, PhaseView[]>();
  for (const p of allPhases) {
    const arr = phasesByMilestone.get(p.milestoneId) ?? [];
    arr.push({
      id: p.id,
      milestoneId: p.milestoneId,
      title: p.title,
      description: p.description,
      status: p.status as PhaseStatus,
      sortOrder: p.sortOrder,
    });
    phasesByMilestone.set(p.milestoneId, arr);
  }

  const taskCountsByMilestone = new Map<number, { total: number; completed: number }>();
  for (const t of guildTasks) {
    if (!t.milestoneId) continue;
    const entry = taskCountsByMilestone.get(t.milestoneId) ?? { total: 0, completed: 0 };
    entry.total++;
    if (t.status === 'Completed') entry.completed++;
    taskCountsByMilestone.set(t.milestoneId, entry);
  }

  return projectRows.map((proj) => {
    const projMilestones: MilestoneView[] = allMilestones
      .filter((m) => m.projectId === proj.id)
      .map((m) => {
        const owner = m.ownerId ? store.users.get(m.ownerId) : null;
        const counts = taskCountsByMilestone.get(m.id) ?? { total: 0, completed: 0 };
        return {
          id: m.id,
          projectId: m.projectId,
          title: m.title,
          description: m.description,
          status: m.status as MilestoneStatus,
          ownerId: m.ownerId,
          ownerName: owner ? owner.displayName ?? owner.username : null,
          sortOrder: m.sortOrder,
          startDate: m.startDate ? new Date(m.startDate) : null,
          deadlineAt: m.deadlineAt ? new Date(m.deadlineAt) : null,
          completedAt: m.completedAt ? new Date(m.completedAt) : null,
          progressPercent: m.progressPercent,
          phases: phasesByMilestone.get(m.id) ?? [],
          linkedTaskCount: counts.total,
          completedTaskCount: counts.completed,
        };
      });

    const progress = calculateProjectProgress(projMilestones);

    return {
      id: proj.id,
      guildId: proj.guildId,
      name: proj.name,
      description: proj.description,
      createdById: proj.createdById,
      createdAt: new Date(proj.createdAt),
      updatedAt: new Date(proj.updatedAt),
      progress,
      milestones: projMilestones,
    };
  });
}
