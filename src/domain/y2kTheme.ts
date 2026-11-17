import { EmbedBuilder } from 'discord.js';

/**
 * Y2K Cyber-Developer Color Palette
 */
export const Y2K_COLORS = {
  // Brand & Primaries
  ELECTRIC_VIOLET: 0x8b5cf6, // Vibrant Electric Violet (#8b5cf6)
  CYBER_BLUE: 0x06b6d4,      // Neon Cyber Blue (#06b6d4)
  SOFT_LAVENDER: 0xc4b5fd,   // Soft Lavender (#c4b5fd)
  ICY_CYAN: 0x38bdf8,        // Icy Cyan (#38bdf8)
  MIDNIGHT: 0x0f172a,        // Deep Midnight (#0f172a)
  SILVER_ACCENT: 0x94a3b8,   // Sleek Metallic Silver (#94a3b8)

  // Functional Status Accents
  SUCCESS_EMERALD: 0x10b981, // Clean Futuristic Emerald
  WARNING_AMBER: 0xf59e0b,   // Cyber Amber Warning
  DANGER_CRIMSON: 0xf43f5e,  // Cyber Crimson Overdue/Blocked
  INFO_SKY: 0x0ea5e9,        // Cool Sky Info
} as const;

export const DEFAULT_BRAND_COLOR = Y2K_COLORS.ELECTRIC_VIOLET;

/**
 * Y2K-inspired Symbols & Text Indicators
 */
export const Y2K_ICONS = {
  SPARKLE: '✦',
  DIAMOND: '◈',
  BULLET: '•',
  ARROW: '›',
  DOUBLE_ARROW: '»',
  SUCCESS: '✓',
  CROSS: '✕',
  TIME: '⌛',
  CLOCK: '⏱️',
  LAUNCH: '🚀',
  SHIPPED: '📦',
  GEAR: '⚙️',
  KEY: '🔑',
  TERMINAL: '💻',
  RADAR: '📡',
  FLAG: '🚩',
  FIRE: '🔥',
} as const;

/**
 * High-tech Unicode Progress Bar for embeds
 */
export function renderY2kProgressBar(percent: number, totalSegments = 14): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filledCount = Math.round((clamped / 100) * totalSegments);
  const emptyCount = totalSegments - filledCount;
  
  // Cyber aesthetic: ▰ and ▱
  const filled = '▰'.repeat(filledCount);
  const empty = '▱'.repeat(emptyCount);
  return `[${filled}${empty}] ${clamped}%`;
}

/**
 * Modern Y2K Developer Communication Tone Helpers
 */
export const Y2K_MESSAGES = {
  GREETING: (name: string) => `✦ Welcome back, **${name}**. Your workspace is ready.`,
  TASK_CREATED: (title: string, id: number) => `✦ Goal **#${id}** added to workspace. Let's get it shipped.`,
  TASK_COMPLETED: (id: number) => `✓ Shipped! Goal **#${id}** is off the board.`,
  TASK_STARTED: (id: number) => `◈ Sprint started on Goal **#${id}**. In progress.`,
  TASK_OVERDUE_ALERT: (id: number) => `⌛ Deadline passed for Goal **#${id}**. Needs team attention.`,
  SETTINGS_SAVED: '✓ Workspace settings updated and locked into storage.',
  UNAUTHORISED: '✕ Access restricted. Authorised management credentials required.',
  SERVER_OWNER_REQUIRED: '✕ Restricted: Only the server owner can modify these permissions.',
} as const;

/**
 * Helper to build consistently styled Y2K embeds
 */
export function createY2kEmbed(options?: {
  color?: number;
  title?: string;
  subtitle?: string;
  footerText?: string;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(options?.color ?? DEFAULT_BRAND_COLOR)
    .setTimestamp();

  if (options?.title) {
    embed.setTitle(options.title.slice(0, 256));
  }
  if (options?.subtitle) {
    embed.setDescription(options.subtitle.slice(0, 4096));
  }
  embed.setFooter({
    text: options?.footerText ?? 'BloxPilot ◈ Bloxberry Labs Workspace',
  });

  return embed;
}
