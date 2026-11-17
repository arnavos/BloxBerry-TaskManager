import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOT_PREFIX,
  COMMAND_ALIASES,
  handlePrefixMessage,
  parseArgs,
} from '../src/bot/prefixHandler.js';
import {
  discordStorage,
  type StorageChannelLike,
  type StorageMessageLike,
} from '../src/storage/discordStorage.js';
import { grantDeadlinePermission } from '../src/services/permissionService.js';
import { upsertUser } from '../src/services/userService.js';

const GUILD_ID = 'guild-prefix-test';
const OWNER_ID = 'owner-1';
const AUTH_USER_ID = 'auth-2';
const REGULAR_USER_ID = 'reg-3';

class MockStorageChannel implements StorageChannelLike {
  name = 'bloxpilot-storage';
  messagesMap = new Map<string, StorageMessageLike>();
  async send(content: string): Promise<StorageMessageLike> {
    const msg: StorageMessageLike = {
      id: `msg-${Date.now()}`,
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

describe('Prefix & No-Prefix System (";" and Short-forms)', () => {
  beforeEach(async () => {
    discordStorage.resetAllForTesting();
    discordStorage.setChannel(GUILD_ID, new MockStorageChannel());

    await discordStorage.saveRecord(GUILD_ID, 'SETTINGS', GUILD_ID, {
      guildId: GUILD_ID,
      guildName: 'Prefix Guild',
      ownerId: OWNER_ID,
      updatedAt: new Date().toISOString(),
    });

    await upsertUser({ id: OWNER_ID, username: 'owner', displayName: 'Owner' }, GUILD_ID);
    await upsertUser({ id: AUTH_USER_ID, username: 'auth', displayName: 'Producer' }, GUILD_ID);
    await upsertUser({ id: REGULAR_USER_ID, username: 'regular', displayName: 'Dev' }, GUILD_ID);

    // Authorise AUTH_USER_ID
    await grantDeadlinePermission({
      guildId: GUILD_ID,
      targetType: 'user',
      targetId: AUTH_USER_ID,
      targetLabel: 'Producer',
      actorId: OWNER_ID,
      actorName: 'Owner',
      guildOwnerId: OWNER_ID,
    });
  });

  it('correctly maps short-form aliases to canonical commands', () => {
    expect(COMMAND_ALIASES['cl']).toBe('checklist');
    expect(COMMAND_ALIASES['checklist']).toBe('checklist');
    expect(COMMAND_ALIASES['add']).toBe('add-task');
    expect(COMMAND_ALIASES['t']).toBe('tasks');
    expect(COMMAND_ALIASES['mt']).toBe('my-tasks');
    expect(COMMAND_ALIASES['h']).toBe('help');
    expect(COMMAND_ALIASES['rm']).toBe('roadmap');
    expect(COMMAND_ALIASES['perms']).toBe('deadline-permissions');
  });

  it('parses quoted and unquoted arguments properly', () => {
    const args = parseArgs('add-task "Create Boss AI" @bob Gameplay Urgent');
    expect(args).toEqual(['add-task', 'Create Boss AI', '@bob', 'Gameplay', 'Urgent']);
  });

  it('allows any member to use prefix commands (e.g. ;checklist or ;cl)', async () => {
    const replies: any[] = [];
    const mockMessage: any = {
      content: ';cl',
      author: { id: REGULAR_USER_ID, bot: false, username: 'regular' },
      guild: { id: GUILD_ID, name: 'Prefix Guild', ownerId: OWNER_ID },
      member: { displayName: 'Dev', roles: { cache: new Map() } },
      reply: async (data: any) => {
        replies.push(data);
        return mockMessage;
      },
    };

    await handlePrefixMessage(mockMessage);
    expect(replies.length).toBe(1);
    expect(replies[0].embeds).toBeDefined();
  });

  it('allows authorised people to run commands WITHOUT prefix (e.g. "cl" or "help")', async () => {
    const replies: any[] = [];
    const mockMessage: any = {
      content: 'cl',
      author: { id: AUTH_USER_ID, bot: false, username: 'auth' },
      guild: { id: GUILD_ID, name: 'Prefix Guild', ownerId: OWNER_ID },
      member: { displayName: 'Producer', roles: { cache: new Map() } },
      reply: async (data: any) => {
        replies.push(data);
        return mockMessage;
      },
    };

    await handlePrefixMessage(mockMessage);
    expect(replies.length).toBe(1);
    expect(replies[0].embeds).toBeDefined();
  });

  it('ignores non-prefix messages from regular members', async () => {
    const replies: any[] = [];
    const mockMessage: any = {
      content: 'cl',
      author: { id: REGULAR_USER_ID, bot: false, username: 'regular' },
      guild: { id: GUILD_ID, name: 'Prefix Guild', ownerId: OWNER_ID },
      member: { displayName: 'Dev', roles: { cache: new Map() } },
      reply: async (data: any) => {
        replies.push(data);
        return mockMessage;
      },
    };

    await handlePrefixMessage(mockMessage);
    expect(replies.length).toBe(0);
  });
});
