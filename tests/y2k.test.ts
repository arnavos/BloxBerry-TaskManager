import { beforeEach, describe, expect, it } from 'vitest';
import {
  discordStorage,
  type StorageChannelLike,
  type StorageMessageLike,
} from '../src/storage/discordStorage.js';
import { getGuildConfig, updateGuildConfig } from '../src/services/configService.js';
import { buildPermissionContext } from '../src/services/permissionService.js';
import { upsertUser } from '../src/services/userService.js';
import {
  createProject,
  addMilestone,
  updateMilestone,
  deleteMilestone,
  listProjectsWithRoadmaps,
} from '../src/services/roadmapService.js';
import {
  buildY2kHomePanel,
  buildY2kTasksPanel,
  buildY2kRoadmapPanel,
  buildY2kSettingsPanel,
} from '../src/bot/embeds/y2kPanels.js';
import { renderY2kProgressBar, Y2K_COLORS } from '../src/domain/y2kTheme.js';

const GUILD_ID = 'guild-y2k-test';
const OWNER_ID = 'owner-y2k';
const STAFF_ID = 'staff-y2k';

class MockStorageChannel implements StorageChannelLike {
  name = 'bloxpilot-storage';
  messagesMap = new Map<string, StorageMessageLike>();
  async send(content: string): Promise<StorageMessageLike> {
    const msg: StorageMessageLike = {
      id: `msg-${Date.now()}_${Math.random()}`,
      content,
      edit: async (c) => {
        msg.content = c;
        return msg;
      },
      delete: async () => msg,
    };
    return msg;
  }
  messages = {
    fetch: async () => new Map<string, StorageMessageLike>(),
  };
}

describe('BloxPilot Y2K UI/UX Redesign & Customisation Suite', () => {
  beforeEach(async () => {
    discordStorage.resetAllForTesting();
    discordStorage.setChannel(GUILD_ID, new MockStorageChannel());

    await discordStorage.saveRecord(GUILD_ID, 'SETTINGS', GUILD_ID, {
      guildId: GUILD_ID,
      guildName: 'Bloxberry Labs Studio',
      ownerId: OWNER_ID,
      updatedAt: new Date().toISOString(),
    });

    await upsertUser({ id: OWNER_ID, username: 'owner', displayName: 'Studio Lead' }, GUILD_ID);
    await upsertUser({ id: STAFF_ID, username: 'staff', displayName: 'Scripter' }, GUILD_ID);
  });

  it('renders cyber Y2K progress bars and color theme accurately', () => {
    const bar0 = renderY2kProgressBar(0, 10);
    expect(bar0).toBe('[▱▱▱▱▱▱▱▱▱▱] 0%');

    const bar50 = renderY2kProgressBar(50, 10);
    expect(bar50).toBe('[▰▰▰▰▰▱▱▱▱▱] 50%');

    const bar100 = renderY2kProgressBar(100, 10);
    expect(bar100).toBe('[▰▰▰▰▰▰▰▰▰▰] 100%');

    expect(Y2K_COLORS.ELECTRIC_VIOLET).toBe(0x8b5cf6);
    expect(Y2K_COLORS.CYBER_BLUE).toBe(0x06b6d4);
  });

  it('supports full customisation of workspace branding and task categories', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });

    const updated = await updateGuildConfig(
      GUILD_ID,
      {
        workspaceName: 'Velocity Core Studio',
        welcomeMessage: 'Building the fastest racing game on Roblox.',
        taskCategories: ['Physics Engine', 'VFX', 'Level Design'],
      },
      ownerCtx,
      'Studio Lead'
    );

    expect(updated.workspaceName).toBe('Velocity Core Studio');
    expect(updated.welcomeMessage).toBe('Building the fastest racing game on Roblox.');
    expect(updated.taskCategories).toEqual(['Physics Engine', 'VFX', 'Level Design']);

    // Persisted to storage record
    const reloaded = getGuildConfig(GUILD_ID);
    expect(reloaded.workspaceName).toBe('Velocity Core Studio');
  });

  it('allows completely editable roadmaps with adding, modifying and deleting stages', async () => {
    const ownerCtx = await buildPermissionContext({ guildId: GUILD_ID, userId: OWNER_ID });

    // 1. Create a custom project without forced fixed stages
    const project = await createProject(
      {
        guildId: GUILD_ID,
        name: 'Project Nova',
        description: 'Open world sci-fi RPG',
        seedDefaultStages: false,
        actorName: 'Studio Lead',
      },
      ownerCtx
    );
    expect(project.milestones).toHaveLength(0);

    // 2. Add custom stages
    const m1 = await addMilestone(
      {
        guildId: GUILD_ID,
        projectId: project.id,
        title: 'Custom Prototyping & Physics',
        actorName: 'Studio Lead',
      },
      ownerCtx
    );
    expect(m1.title).toBe('Custom Prototyping & Physics');

    const m2 = await addMilestone(
      {
        guildId: GUILD_ID,
        projectId: project.id,
        title: 'Alpha Closed Playtest',
        actorName: 'Studio Lead',
      },
      ownerCtx
    );
    expect(m2.sortOrder).toBe(2);

    // 3. Edit milestone
    const edited = await updateMilestone(
      m1.id,
      {
        guildId: GUILD_ID,
        title: 'High-Speed Physics Engine v2',
        status: 'In Progress',
        progressPercent: 40,
        actorName: 'Studio Lead',
      },
      ownerCtx
    );
    expect(edited.title).toBe('High-Speed Physics Engine v2');
    expect(edited.status).toBe('In Progress');

    // 4. Delete milestone
    const delRes = await deleteMilestone(m2.id, GUILD_ID, ownerCtx, 'Studio Lead');
    expect(delRes.title).toBe('Alpha Closed Playtest');

    const roadmaps = await listProjectsWithRoadmaps(GUILD_ID);
    expect(roadmaps[0].milestones).toHaveLength(1);
    expect(roadmaps[0].milestones[0].title).toBe('High-Speed Physics Engine v2');
  });

  it('builds interactive Y2K panels with button navigation', async () => {
    const homePanel = buildY2kHomePanel({
      guildId: GUILD_ID,
      userName: 'Studio Lead',
      project: null,
      tasks: [],
    });
    expect(homePanel.embed.data.title).toContain('CONTROL CENTRE');
    expect(homePanel.components.length).toBe(2); // Nav row + action row

    const tasksPanel = buildY2kTasksPanel({
      guildId: GUILD_ID,
      tasks: [],
    });
    expect(tasksPanel.embed.data.title).toContain('TASK WORKSPACE');

    const settingsPanel = buildY2kSettingsPanel({
      guildId: GUILD_ID,
      isOwner: true,
      canManage: true,
      authorisedUsers: [],
      authorisedRoles: [],
    });
    expect(settingsPanel.embed.data.title).toContain('WORKSPACE CONFIGURATION');
  });
});
