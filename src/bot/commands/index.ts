import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { adminCommands } from './adminCommands.js';
import { deadlineCommands } from './deadlineCommands.js';
import { roadmapCommands } from './roadmapCommands.js';
import { taskCommands } from './taskCommands.js';
import { bloxPilotCommands } from './bloxPilotCommands.js';

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export const allCommands: BotCommand[] = [
  ...bloxPilotCommands,
  ...taskCommands,
  ...deadlineCommands,
  ...roadmapCommands,
  ...adminCommands,
];

export const commandMap = new Map<string, BotCommand>(
  allCommands.map((cmd) => [cmd.data.name, cmd])
);

export function getCommandJsonPayloads(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return allCommands.map((cmd) => cmd.data.toJSON());
}
