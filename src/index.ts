/**
 * clawnductor — OpenClaw plugin entry point
 *
 * Weaponizes Claude Code from OpenClaw: persistent sessions (jams),
 * multi-agent ensembles, deep planning overtures, and fleet review finales.
 *
 * Zero external dependencies — ships as pure Node.js TypeScript.
 * All Claude sessions default to --permission-mode bypassPermissions.
 *
 * Tool naming theme: music puns
 *   jam_*       single-session operations (a "jam session")
 *   bandstand   all-sessions health overview
 *   ensemble_*  multi-agent ensemble
 *   overture_*  deep planning (ultraplan) — introduces the work
 *   finale_*    fleet code review — the closing movement
 *   purge_stage wipe project state
 */
import { SessionManager } from './session-manager.js';
import type { PermissionMode, EffortLevel, AgentPersona, PluginConfig } from './types.js';
import {
  validateName,
  validateAgentName,
  validateCwd,
  validateRegex,
  validatePermissionMode,
  validateEffort,
  validateTimeout,
  validatePositiveInt,
  validateStringField,
  validateStringArray,
  validateBoolean,
  MAX_TIMEOUT_MS,
} from './validation.js';

// ─── Plugin ───────────────────────────────────────────────────────────────────

const plugin = {
  id: 'clawnductor',
  name: 'Clawnductor',
  description:
    'Weaponize Claude Code from OpenClaw — persistent sessions, multi-agent ensembles, ultraplan, and fleet review.',

  register(api: ClawApi) {
    const rawConfig = (api.pluginConfig ?? {}) as Partial<PluginConfig>;

    let manager: SessionManager | null = null;

    function getManager(): SessionManager {
      if (!manager) {
        api.logger.info('[clawnductor] Initialising SessionManager on first use');
        manager = new SessionManager(rawConfig, (msg) => api.logger.info(msg));
      }
      return manager;
    }

    // ─── Logging wrapper ──────────────────────────────────────────────────────

    function registerTool(t: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (id: unknown, args: Record<string, unknown>) => Promise<unknown>;
    }): void {
      api.registerTool({
        ...t,
        execute: async (id, args) => {
          api.logger.info(`[tool:${t.name}] invoked`);
          try {
            const result = await t.execute(id, args);
            if (result && typeof result === 'object' && 'ok' in result && !(result as { ok: boolean }).ok) {
              api.logger.error(`[tool:${t.name}] returned ok:false —`, (result as { error?: unknown }).error ?? result);
            }
            return result;
          } catch (err) {
            api.logger.error(`[tool:${t.name}] threw — ${err instanceof Error ? err.message : String(err)}`);
            throw err;
          }
        },
      });
    }

    // ─── Service lifecycle ────────────────────────────────────────────────────

    api.registerService({
      id: 'clawnductor',
      start: () => api.logger.info('[clawnductor] Plugin registered (lazy — activates on first use)'),
      stop: () => {
        if (manager) {
          manager.shutdown().catch(() => {});
          manager = null;
        }
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // JAM — Single-session tools
    // ═══════════════════════════════════════════════════════════════════════════

    registerTool({
      name: 'jam_start',
      description:
        'Start a persistent Claude Code session (a "jam"). Returns a session name you pass to jam_play, jam_bridge, etc. Sessions stay alive across requests — use jam_list to see active ones.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Session name (auto-generated if omitted)' },
          cwd: { type: 'string', description: 'Working directory' },
          model: { type: 'string', description: 'Model alias or ID: opus, sonnet, haiku, or full model name' },
          permissionMode: {
            type: 'string',
            enum: ['bypassPermissions', 'acceptEdits', 'auto', 'plan'],
            description: 'Permission mode (default: bypassPermissions)',
          },
          effort: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
          },
          allowedTools: { type: 'array', items: { type: 'string' } },
          disallowedTools: { type: 'array', items: { type: 'string' } },
          maxTurns: { type: 'number' },
          appendSystemPrompt: { type: 'string' },
          bare: { type: 'boolean', description: 'Skip hooks, LSP, auto-memory, CLAUDE.md' },
          worktree: { type: ['string', 'boolean'], description: 'Run in isolated git worktree' },
          resumeSessionId: { type: 'string', description: 'Resume existing Claude session by ID' },
          forkSession: { type: 'boolean' },
          mcpConfig: { type: ['string', 'array'], items: { type: 'string' } },
          noSessionPersistence: { type: 'boolean' },
        },
      },
      execute: async (_id, args) => {
        const input: Parameters<SessionManager['startSession']>[0] = {};
        if (args.name !== undefined) input.name = validateName(args.name, 'name');
        if (args.cwd !== undefined) input.cwd = validateCwd(args.cwd, 'cwd');
        if (args.model !== undefined) input.model = validateStringField(args.model, 'model', 100);
        if (args.permissionMode !== undefined) input.permissionMode = validatePermissionMode(args.permissionMode, 'permissionMode') as PermissionMode;
        if (args.effort !== undefined) input.effort = validateEffort(args.effort, 'effort') as EffortLevel;
        if (args.allowedTools !== undefined) input.allowedTools = validateStringArray(args.allowedTools, 'allowedTools');
        if (args.disallowedTools !== undefined) input.disallowedTools = validateStringArray(args.disallowedTools, 'disallowedTools');
        if (args.maxTurns !== undefined) input.maxTurns = validatePositiveInt(args.maxTurns, 'maxTurns', 500);
        if (args.appendSystemPrompt !== undefined) input.appendSystemPrompt = validateStringField(args.appendSystemPrompt, 'appendSystemPrompt');
        if (args.bare !== undefined) input.bare = validateBoolean(args.bare, 'bare');
        if (args.resumeSessionId !== undefined) input.resumeSessionId = validateStringField(args.resumeSessionId, 'resumeSessionId', 200);
        if (args.forkSession !== undefined) input.forkSession = validateBoolean(args.forkSession, 'forkSession');
        if (args.noSessionPersistence !== undefined) input.noSessionPersistence = validateBoolean(args.noSessionPersistence, 'noSessionPersistence');
        const info = await getManager().startSession(input);
        return { ok: true, ...info };
      },
    });

    registerTool({
      name: 'jam_play',
      description: 'Send a prompt to an active jam session and get the response. Use nowait:true to return immediately without blocking the channel — poll jam_status for busy:false, then read lastOutput.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Session name from jam_start' },
          message: { type: 'string', description: 'Prompt to send' },
          plan: { type: 'boolean', description: 'Enter plan mode for this message' },
          timeout: { type: 'number', description: 'Timeout in ms (default 300000)' },
          stream: { type: 'boolean', description: 'Collect chunks as they arrive into result.chunks[]' },
          nowait: { type: 'boolean', description: 'Return immediately without waiting for the response. Poll jam_status until busy:false, then read lastOutput.' },
        },
        required: ['name', 'message'],
      },
      execute: async (_id, args) => {
        const name = validateName(args.name, 'name');
        const message = validateStringField(args.message, 'message');
        const sendOpts = {
          plan: args.plan !== undefined ? validateBoolean(args.plan, 'plan') : undefined,
          timeout: args.timeout !== undefined ? validateTimeout(args.timeout, 'timeout') : undefined,
        };

        if (args.nowait) {
          // Pre-check synchronously so busy/not-ready errors surface immediately
          // rather than being silently swallowed by the fire-and-forget.
          const s = getManager().getStatus(name);
          if (!s.stats.isReady) throw new Error(`Session "${name}" is not ready`);
          if (s.stats.busy) throw new Error(`Session "${name}" is busy`);
          getManager().sendMessage(name, message, sendOpts).catch(() => {});
          return { ok: true, pending: true, name };
        }

        const chunks: string[] = [];
        const result = await getManager().sendMessage(
          name,
          message,
          { ...sendOpts, onChunk: args.stream ? (c: string) => chunks.push(c) : undefined },
        );
        return { ok: true, ...result, ...(args.stream ? { chunks } : {}) };
      },
    });

    registerTool({
      name: 'jam_end',
      description: 'Stop an active jam session and free its subprocess.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      execute: async (_id, args) => {
        await getManager().stopSession(validateName(args.name, 'name'));
        return { ok: true };
      },
    });

    registerTool({
      name: 'jam_list',
      description: 'List all active and persisted jam sessions.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (!manager) return { ok: true, sessions: [], persisted: [] };
        return { ok: true, sessions: manager.listSessions(), persisted: manager.listPersistedSessions() };
      },
    });

    registerTool({
      name: 'jam_status',
      description: 'Detailed status for a single jam session: context %, tokens, cost, uptime, retries.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      execute: async (_id, args) => {
        const status = getManager().getStatus(validateName(args.name, 'name'));
        return { ok: true, ...status };
      },
    });

    registerTool({
      name: 'bandstand',
      description:
        'Health overview of every active jam session: readiness, busy/paused state, cost, context %. Use this for a dashboard view; use jam_status for single-session detail.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (!manager) return { ok: true, sessions: 0, sessionNames: [], details: [] };
        return manager.health();
      },
    });

    registerTool({
      name: 'jam_groove',
      description: "Search a session's event history with a regex pattern.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pattern: { type: 'string', description: 'Regex pattern' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['name', 'pattern'],
      },
      execute: async (_id, args) => {
        const matches = await getManager().grepSession(
          validateName(args.name, 'name'),
          validateRegex(args.pattern, 'pattern'),
          args.limit !== undefined ? validatePositiveInt(args.limit, 'limit', 500) : undefined,
        );
        return { ok: true, count: matches.length, matches };
      },
    });

    registerTool({
      name: 'jam_bridge',
      description:
        'Compact a session\'s context to reclaim context window space. Like a musical bridge — connects what came before to what comes next.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string', description: 'Optional summary to guide compaction' },
        },
        required: ['name'],
      },
      execute: async (_id, args) => {
        const name = validateName(args.name, 'name');
        const summary = args.summary !== undefined ? validateStringField(args.summary, 'summary') : undefined;
        await getManager().compactSession(name, summary);
        return { ok: true };
      },
    });

    registerTool({
      name: 'jam_transpose',
      description:
        'Switch the model for a running session. Restarts subprocess with --resume to preserve history. Like transposing a song to a new key.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          model: { type: 'string', description: 'New model: opus, sonnet, haiku, or full ID' },
        },
        required: ['name', 'model'],
      },
      execute: async (_id, args) => {
        const info = await getManager().switchModel(
          validateName(args.name, 'name'),
          validateStringField(args.model, 'model', 100),
        );
        return { ok: true, restarted: true, ...info };
      },
    });

    registerTool({
      name: 'jam_rekey',
      description:
        'Update allowed/disallowed tools for a running session. Restarts with --resume. Like changing the key signature mid-score.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          allowedTools: { type: 'array', items: { type: 'string' } },
          disallowedTools: { type: 'array', items: { type: 'string' } },
          removeTools: { type: 'array', items: { type: 'string' }, description: 'Remove from current lists' },
          merge: { type: 'boolean', description: 'Merge with existing lists (default: replace)' },
        },
        required: ['name'],
      },
      execute: async (_id, args) => {
        const info = await getManager().updateTools(validateName(args.name, 'name'), {
          allowedTools: args.allowedTools !== undefined ? validateStringArray(args.allowedTools, 'allowedTools') : undefined,
          disallowedTools: args.disallowedTools !== undefined ? validateStringArray(args.disallowedTools, 'disallowedTools') : undefined,
          removeTools: args.removeTools !== undefined ? validateStringArray(args.removeTools, 'removeTools') : undefined,
          merge: args.merge !== undefined ? validateBoolean(args.merge, 'merge') : undefined,
        });
        return { ok: true, restarted: true, ...info };
      },
    });

    registerTool({
      name: 'jam_roster',
      description: 'List agent definitions from .claude/agents/ in a project directory.',
      parameters: {
        type: 'object',
        properties: { cwd: { type: 'string', description: 'Project directory to scan' } },
      },
      execute: async (_id, args) => {
        const cwd = args.cwd !== undefined ? validateCwd(args.cwd, 'cwd') : undefined;
        const agents = getManager().listAgents(cwd);
        return { ok: true, agents };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ENSEMBLE — Multi-agent ensemble tools
    // ═══════════════════════════════════════════════════════════════════════════

    registerTool({
      name: 'ensemble_start',
      description:
        'Start a multi-agent ensemble on a coding task. Agents work in parallel git worktrees, vote on completion, and merge to main. Returns an ensemble ID — poll with ensemble_status.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The coding task to complete' },
          projectDir: { type: 'string', description: 'Project directory' },
          maxRounds: { type: 'number', description: 'Max collaboration rounds (default 15)' },
          agents: {
            type: 'array',
            description: 'Agent definitions. Default: 3-agent Composer/Performer/Critic ensemble.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                emoji: { type: 'string' },
                persona: { type: 'string' },
                model: { type: 'string' },
                permissionMode: { type: 'string', enum: ['bypassPermissions', 'acceptEdits', 'auto', 'plan'] },
              },
              required: ['name', 'emoji', 'persona'],
            },
          },
          agentTimeoutMs: { type: 'number', description: 'Per-agent timeout per round ms (default 1800000)' },
          maxTurnsPerAgent: { type: 'number', description: 'Max tool turns per agent per round (default 30)' },
          maxBudgetUsd: { type: 'number' },
          defaultPermissionMode: {
            type: 'string',
            enum: ['bypassPermissions', 'acceptEdits', 'auto', 'plan'],
            description: 'Default for agents (default: bypassPermissions)',
          },
        },
        required: ['task', 'projectDir'],
      },
      execute: async (_id, args) => {
        const task = validateStringField(args.task, 'task');
        const projectDir = validateCwd(args.projectDir, 'projectDir');

        const defaultAgents: AgentPersona[] = [
          { name: 'Composer', emoji: '🎼', persona: 'Technical architect: decompose requirements, design interfaces, write plan.md with clear task checkboxes and acceptance criteria.' },
          { name: 'Performer', emoji: '🎸', persona: 'Implementation engineer: claim tasks from plan.md, write correct tested code, run tests until passing, merge to main.' },
          { name: 'Critic', emoji: '🎭', persona: 'Quality gate: review Performer\'s commits for correctness, test coverage, and spec compliance. APPROVE or REQUEST_CHANGES with specific feedback.' },
        ];

        const rawAgents = args.agents as AgentPersona[] | undefined;
        let agents = rawAgents && rawAgents.length > 0 ? rawAgents : defaultAgents;
        agents = agents.map((a) => ({
          ...a,
          name: validateAgentName(a.name, 'agent.name'),
          emoji: validateStringField(a.emoji, 'agent.emoji', 10),
          persona: validateStringField(a.persona, 'agent.persona'),
          ...(a.model !== undefined ? { model: validateStringField(a.model, 'agent.model', 100) } : {}),
          ...(a.permissionMode !== undefined ? { permissionMode: validatePermissionMode(a.permissionMode, 'agent.permissionMode') as PermissionMode } : {}),
        }));

        const ensemble = getManager().ensembleStart(task, {
          agents,
          maxRounds: args.maxRounds !== undefined ? validatePositiveInt(args.maxRounds, 'maxRounds', 50) : 15,
          projectDir,
          agentTimeoutMs: args.agentTimeoutMs !== undefined ? validateTimeout(args.agentTimeoutMs, 'agentTimeoutMs') : undefined,
          maxTurnsPerAgent: args.maxTurnsPerAgent !== undefined ? validatePositiveInt(args.maxTurnsPerAgent, 'maxTurnsPerAgent', 200) : undefined,
          maxBudgetUsd: args.maxBudgetUsd as number | undefined,
          defaultPermissionMode: args.defaultPermissionMode !== undefined
            ? validatePermissionMode(args.defaultPermissionMode, 'defaultPermissionMode') as PermissionMode
            : 'bypassPermissions',
        });

        return { ok: true, id: ensemble.id, status: ensemble.status, task: ensemble.task };
      },
    });

    registerTool({
      name: 'ensemble_status',
      description: 'Get current status of an ensemble: round, responses, consensus votes.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Ensemble ID from ensemble_start' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        const ensemble = getManager().ensembleStatus(validateStringField(args.id, 'id', 36));
        if (!ensemble) return { ok: false, error: 'Ensemble not found' };
        return { ok: true, ...ensemble };
      },
    });

    registerTool({
      name: 'ensemble_abort',
      description: 'Stop all agent sessions and terminate an ensemble.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        getManager().ensembleAbort(validateStringField(args.id, 'id', 36));
        return { ok: true };
      },
    });

    registerTool({
      name: 'ensemble_cue',
      description: "Inject a message into all agents' prompts for the next round. Like a conductor's cue.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          message: { type: 'string', description: 'Message to inject into all agents' },
        },
        required: ['id', 'message'],
      },
      execute: async (_id, args) => {
        getManager().ensembleInject(
          validateStringField(args.id, 'id', 36),
          validateStringField(args.message, 'message'),
        );
        return { ok: true };
      },
    });

    registerTool({
      name: 'ensemble_score',
      description:
        'Review completed ensemble output: changed files, branches, worktrees, plan.md, and per-agent summaries. Call before ensemble_accept or ensemble_reject.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        const result = await getManager().ensembleReview(validateStringField(args.id, 'id', 36));
        return { ok: true, ...result };
      },
    });

    registerTool({
      name: 'ensemble_accept',
      description: 'Accept ensemble work and clean up: removes worktrees, ensemble/* branches, plan.md, reviews/.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        const result = await getManager().ensembleAccept(validateStringField(args.id, 'id', 36));
        return { ok: true, ...result };
      },
    });

    registerTool({
      name: 'ensemble_reject',
      description: 'Reject ensemble work: rewrites plan.md with feedback. Worktrees preserved for retry.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          feedback: { type: 'string', description: 'What needs to change' },
        },
        required: ['id', 'feedback'],
      },
      execute: async (_id, args) => {
        const result = await getManager().ensembleReject(
          validateStringField(args.id, 'id', 36),
          validateStringField(args.feedback, 'feedback'),
        );
        return { ok: true, ...result };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // OVERTURE — Deep planning (ultraplan)
    // ═══════════════════════════════════════════════════════════════════════════

    registerTool({
      name: 'overture_start',
      description:
        'Start a deep planning session — an Opus agent that explores your codebase thoroughly and produces a detailed implementation plan. Runs up to 30 minutes in background. Poll with overture_status.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What to plan' },
          cwd: { type: 'string', description: 'Project directory to explore' },
          model: { type: 'string', description: 'Model (default: opus)' },
          timeout: { type: 'number', description: 'Max time in ms (default 1800000)' },
        },
        required: ['task'],
      },
      execute: async (_id, args) => {
        const result = getManager().ultraplanStart(validateStringField(args.task, 'task'), {
          cwd: args.cwd !== undefined ? validateCwd(args.cwd, 'cwd') : undefined,
          model: args.model !== undefined ? validateStringField(args.model, 'model', 100) : 'opus',
          timeout: args.timeout !== undefined ? validateTimeout(args.timeout, 'timeout') : undefined,
        });
        return { ok: true, id: result.id, status: result.status, sessionName: result.sessionName };
      },
    });

    registerTool({
      name: 'overture_status',
      description: 'Get the status and plan text from an overture session.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        const result = getManager().ultraplanStatus(validateStringField(args.id, 'id', 36));
        if (!result) return { ok: false, error: 'Overture not found' };
        return { ok: true, ...result };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FINALE — Fleet code review (ultrareview)
    // ═══════════════════════════════════════════════════════════════════════════

    registerTool({
      name: 'finale_start',
      description:
        'Launch a fleet of specialized code review agents in parallel — security, logic, performance, API, types, concurrency, and more. Runs in background. Poll with finale_status.',
      parameters: {
        type: 'object',
        properties: {
          projectDir: { type: 'string', description: 'Project directory to review' },
          agentCount: { type: 'number', description: 'Number of reviewer agents (1-20, default 5)' },
          maxDurationMinutes: { type: 'number', description: 'Per-agent timeout in minutes (5-25, default 10)' },
          model: { type: 'string', description: 'Model for all reviewers' },
          focus: { type: 'string', description: 'Custom review focus' },
        },
        required: ['projectDir'],
      },
      execute: async (_id, args) => {
        const result = getManager().ultrareviewStart(validateCwd(args.projectDir, 'projectDir'), {
          agentCount: args.agentCount !== undefined ? validatePositiveInt(args.agentCount, 'agentCount', 20) : undefined,
          maxDurationMinutes: args.maxDurationMinutes !== undefined ? validatePositiveInt(args.maxDurationMinutes, 'maxDurationMinutes', 25) : undefined,
          model: args.model !== undefined ? validateStringField(args.model, 'model', 100) : undefined,
          focus: args.focus !== undefined ? validateStringField(args.focus, 'focus') : undefined,
        });
        return { ok: true, id: result.id, ensembleId: result.ensembleId, status: result.status, agentCount: result.agentCount };
      },
    });

    registerTool({
      name: 'finale_status',
      description: 'Get status and findings from a finale review fleet.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (_id, args) => {
        const result = getManager().ultrareviewStatus(validateStringField(args.id, 'id', 36));
        if (!result) return { ok: false, error: 'Finale not found' };
        return { ok: true, ...result };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE — Project management
    // ═══════════════════════════════════════════════════════════════════════════

    registerTool({
      name: 'purge_stage',
      description:
        'Wipe Claude Code project state (transcripts, tasks, file history) via `claude project purge`. Defaults to dry-run — pass dry_run: false to actually delete.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (defaults to cwd)' },
          all: { type: 'boolean', description: 'Purge all projects' },
          dry_run: { type: 'boolean', description: 'Dry run (default true)' },
        },
      },
      execute: async (_id, args) => {
        const result = await getManager().purgeProject({
          path: args.path !== undefined ? validateCwd(args.path, 'path') : undefined,
          all: args.all !== undefined ? validateBoolean(args.all, 'all') : undefined,
          dryRun: args.dry_run !== undefined ? validateBoolean(args.dry_run, 'dry_run') : true,
        });
        return { ok: true, ...result };
      },
    });
  },
};

export default plugin;

// ─── OpenClaw API type (minimal) ──────────────────────────────────────────────

interface ClawApi {
  pluginConfig?: Record<string, unknown>;
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  registerService(s: { id: string; start: () => void; stop: () => void }): void;
  registerTool(t: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: unknown, args: Record<string, unknown>) => Promise<unknown>;
  }): void;
}
