# Bloxberry Labs — Project & Task Management Discord Bot

Production-ready Discord project management, interactive checklist tracking, deadline monitoring, staff accountability, and game development roadmap bot for the **Bloxberry Labs** Discord server.

Designed to run on a single **Render Web Service** with **zero external database dependencies** (no PostgreSQL, SQLite, Neon, or cloud database). Discord itself acts as the persistent storage engine using a private, bot-managed storage channel (`#bloxpilot-storage`).

---

## Zero-External-Database Architecture

### How Discord Storage Works
1. **Private Dedicated Storage Channel (`#bloxpilot-storage`)**:
   - On startup, the bot checks for a channel named `bloxpilot-storage`. If missing, it creates the channel automatically.
   - Strict permission overwrites: `@everyone` is denied `ViewChannel`. The server owner is granted `ViewChannel: true` and `SendMessages: false` (to prevent accidental chat clutter), and the bot has full administrative and messaging rights.
2. **Structured Record Messages**:
   - Every entity (task, assignment, deadline permission grant, roadmap project, milestone, development phase, notification record, and audit log) is stored as an individual message formatted as:
     ```text
     [BLOX:<TYPE>:<KEY>]
     ```json
     { ...payload... }
     ```
     ```
   - Examples of types: `SETTINGS`, `USER`, `ROLE`, `TASK`, `PERMISSION`, `NOTIFICATION`, `PROJECT`, `MILESTONE`, `PHASE`, `AUDIT`.
3. **In-Place Updates (`message.edit`)**:
   - When a task, status, or milestone updates, the bot locates the existing Discord message ID and executes `message.edit(...)` in place instead of creating duplicate messages.
4. **Bootstrapping & Restart Recovery (`messages.fetch`)**:
   - On process restart or Render redeployment, `loadFromChannel` paginates backward using Discord's REST API (`limit: 100`, `before: messageId`) to fetch all messages and reconstruct the complete in-memory indexed cache.
5. **Rate-Limit Safe Queue**:
   - Storage writes and edits are serialized through an asynchronous queue per guild to strictly comply with Discord's REST rate limits (~5 req/5s) and prevent race conditions.

### Architectural Limitations & Characteristics
- **Message Size Ceiling**: Discord messages have a 2,000-character limit. Because each task, milestone, or permission grant is stored in its own individual message, payloads stay well below ~500 bytes.
- **Cold Boot Latency**: Upon bot startup, fetching storage messages across a server with hundreds of records takes 1–3 seconds via paginated REST queries before the in-memory cache is fully warmed.
- **Manual Intervention Guard**: The `#bloxpilot-storage` channel is private. Server members cannot see or modify it. If a message is deleted manually by the owner, the bot detects the missing message on the next write and posts a fresh record.

---

## Environment Variables

Only **one secret** is required to run:

| Variable | Requirement | Description / Source |
| --- | --- | --- |
| `DISCORD_TOKEN` | **Required** | Bot token from [Discord Developer Portal](https://discord.com/developers/applications) → Your App → **Bot** → **Reset Token** |
| `DISCORD_GUILD_ID` | **Optional** *(recommended)* | Your Discord server ID. Enables instant guild-scoped slash command registration on startup |
| `PORT` | **Automatic** | Automatically provided by Render at runtime (defaults to `3000` locally) |

All other settings have sensible defaults:
- `HOST`: `0.0.0.0`
- `NODE_ENV`: `production` on Render, `development` locally
- `DEFAULT_TIMEZONE`: `Asia/Kolkata`
- `DEPLOY_COMMANDS_ON_BOOT`: `true` (registers slash commands on startup)
- `DEADLINE_CHECK_INTERVAL_MS`: `30000` (scheduler interval: 30 seconds)
- `MANAGEMENT_OVERDUE_REMINDER_DELAY_MINUTES`: `120` (2 hours overdue before management escalation)

---

## Discord Developer Portal Configuration

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**:
   - Enable **Server Members Intent** (`GuildMembers` privileged gateway intent). This enables the bot to sync member lists, roles, and names for task assignments and permissions.
   - Copy your **Bot Token** (`DISCORD_TOKEN`).
3. Under **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Manage Channels`, `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`
   - Open the generated URL to invite the bot to your Bloxberry Labs server.

---

## Commands Reference

### 1. Task & Checklist Management
- `/checklist` — Opens the interactive task hub with buttons:
  - ➕ **Add Goal** (opens modal for title, description, category, priority, optional deadline, followed by user assignment)
  - 📋 **View Checklists** (paginated server tasks)
  - 👤 **My Tasks** (user's personal assigned tasks)
  - 📊 **Task Overview** (due today, overdue, upcoming, workload)
- `/add-task` — Quick task creation command with staff assignment.
- `/my-tasks` — View your personal tasks with optional status filter.
- `/tasks` — Organised team overview (`overview`, `all`, `due_today`, `upcoming`, `overdue`, `in_progress`, `completed`).
- `/staff-tasks @user` — View a specific staff member's tasks (management or self).
- `/task-details` — View complete task card, countdown, and audit history.
- `/task-edit` — Edit task details (creator or authorised management).
- `/task-complete` — Mark a task as completed (assignee or authorised management).
- `/task-delete` — Delete a task (creator or authorised management).

### 2. Deadline Management & Governance
- `/deadline-set` — Assign a deadline to an existing task (authorised users only).
- `/deadline-edit` — Update an existing deadline (authorised users only).
- `/deadline-remove` — Remove a deadline (authorised users only).
- `/deadline-permissions` — Inspect all authorised users and roles.
- `/deadline-authorise user @user` — **Server Owner Only**: Authorise an individual staff member.
- `/deadline-authorise role @role` — **Server Owner Only**: Authorise an entire Discord role.
- `/deadline-revoke user @user` — **Server Owner Only**: Revoke user authorisation.
- `/deadline-revoke role @role` — **Server Owner Only**: Revoke role authorisation.

### 3. Game Development Roadmap
- `/roadmap` — Display the game progression roadmap with progress bar, active focus stage, and milestone breakdown.
- `/roadmap-create` — Initialise a roadmap project (pre-populated with 12 editable Roblox development stages).
- `/roadmap-add-milestone` — Add a milestone or phase to a project.
- `/roadmap-update` — Update status, progress %, deadline, owner, or reorder stages.
- `/roadmap-progress` — Summary progress report across all milestones.
- `/roadmap-view` — Inspect a specific milestone or project in detail.

### 4. System & Administration
- `/management-panel` — In-Discord staff capabilities, governance status, and command shortcuts.
- `/bot-status` — System health, gateway ping, storage channel status, uptime, and task counts.
- `/help` — Complete command reference and permission rules.

---

## Local Development & Testing

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Set DISCORD_TOKEN in .env

# 3. Start bot in development mode (hot-reloads with tsx)
npm run dev

# 4. Typecheck, build and test
npm run typecheck
npm run build
npm test
```

---

## Render Web Service Deployment

1. Push your repository to GitHub.
2. In [Render](https://render.com), create a new **Web Service** from your repository using `render.yaml` or manually:
   - **Runtime**: `Node` (`NODE_VERSION=22`)
   - **Build Command**: `npm ci && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. In Render's **Environment** tab, set:
   - `DISCORD_TOKEN` = your Discord bot token
   - `DISCORD_GUILD_ID` = your server ID (optional, recommended)
4. Deploy. The web service starts immediately, binds to `$PORT` with Fastify `/health` to satisfy Render's health checks, connects to Discord, automatically provisions `#bloxpilot-storage` on first boot, and persists all state across restarts.
# BloxBerry-TaskManager
