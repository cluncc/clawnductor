# Clawnductor — Engineering Journal

## What Is This

Clawnductor is an [OpenClaw](https://openclaw.dev) plugin that turns Claude Code into a programmable multi-agent system. From inside OpenClaw you can start persistent Claude Code subprocesses, assemble ensembles of agents that collaborate over git worktrees, launch deep planning runs, and dispatch fleets of specialized code reviewers.

The name is a portmanteau: **Claude** + **conductor** (the person who directs an ensemble). Every public-facing identifier follows a music pun theme:

| Prefix | Concept |
|---|---|
| `jam_*` | Single persistent coding session |
| `bandstand` | All-sessions health dashboard |
| `ensemble_*` | Multi-agent collaborative ensemble |
| `overture_*` | Deep planning run (introduces the work) |
| `finale_*` | Fleet code review (closing movement) |
| `purge_stage` | Wipe project state |

---

## Architecture

### Plugin entry point (`src/index.ts`)

OpenClaw plugins export a default object with a `register(api)` method. The plugin lazily constructs a `SessionManager` on first tool use and routes all 23 registered tools to the appropriate manager methods. The `ClawApi` interface is declared locally — no OpenClaw types are imported at runtime, which keeps the package free of peer-dependency coupling at build time.

All tool inputs pass through `src/validation.ts` before reaching business logic. A logging wrapper around each tool call (`registerTool`) ensures every invocation is recorded to OpenClaw's logger and any thrown errors are caught and re-emitted with tool-name context.

### Session layer (`src/session.ts`)

`PersistentClaudeSession` wraps a `claude -p --input-format stream-json --output-format stream-json` subprocess as a persistent `EventEmitter`. One instance = one long-lived subprocess that accepts multi-turn conversations.

**Wire protocol:**
- Stdin: newline-delimited JSON `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`
- Stdout: newline-delimited JSON events —
  - `system/init` — emitted once on startup, carries `session_id`
  - `assistant` — carries content blocks and per-turn token usage
  - `result/success` or `result/error` — end of turn signal, carries total cost

**Key design decisions:**

- `start()` waits for `system/init` (or a 20-second fallback timeout) before resolving, so callers always receive a ready session.
- A single `_resolve`/`_reject` pair manages one in-flight turn; concurrent calls are rejected with `"Session is busy"`.
- `'chunk'` events are forwarded to callers while the turn is in progress, enabling streaming to tool consumers.
- `'turn-end'` cleans up the chunk listener in all code paths (success, error, timeout, stop).
- The history buffer is a rolling window of the last 500 events. On overflow, the oldest event is discarded (`push` + `shift`), preserving the most recent context for `jam_groove`.

### Session manager (`src/session-manager.ts`)

`SessionManager` is the central state machine:

| Concern | Mechanism |
|---|---|
| Session registry | `Map<name, SessionRecord>` (in-memory) |
| Session persistence | `~/.openclaw/clawnductor-sessions.json` (7-day disk TTL) |
| Orphan cleanup | PID file at `~/.openclaw/clawnductor-pids.json` — on startup, surviving PIDs from the previous process are sent SIGTERM (verified via `/proc/<pid>/cmdline`), then SIGKILL after 3 s with a re-verify to guard against PID recycling |
| Memory TTL | Configurable, default 120 min; GC runs every 60 s |
| Concurrent session cap | `maxConcurrentSessions` (default 5) |
| Fault tolerance | `CircuitBreaker` — 3 consecutive failures trigger exponential backoff (1 s × 2ⁿ, max 5 min) |
| Duplicate session names | Restarting a session with an existing name stops the old subprocess first; errors if the old session is busy |

**`switchModel` and `updateTools`** restart the session with `--resume <sessionId>` to preserve conversation history. Both implement rollback: the session map entry is temporarily removed (to satisfy the concurrent-session cap without double-counting), and the old session is only stopped after the new one is confirmed started.

**Ultrareview** dispatches up to 20 specialized reviewer agents as an ensemble and polls for completion using tracked `setInterval` timers. Pollers are stored in `_reviewPollers` so `shutdown()` can clear them without leaking timers.

### Ensemble (`src/ensemble.ts`)

An `Ensemble` coordinates a set of `AgentPersona` definitions through rounds:

1. **Round 1 (Scoring/Planning):** Every agent writes `plan.md` in the project root. Business code changes are forbidden.
2. **Round 2+ (Implementation):** Agents claim `- [ ]` checkboxes, implement, commit, and merge to main.
3. **Consensus:** All agents voting `[CONSENSUS: YES]` ends the ensemble. Max rounds is a safety cap.

Each agent gets an isolated git worktree at `<projectDir>/.worktrees/<AgentName>` on branch `ensemble/<AgentName>`. Worktrees let agents write code without interfering with each other; the main branch is the merge target.

Worktrees are set up in one batch (`git worktree list --porcelain` once, parsed into a Set) rather than querying per-agent, which would be O(n) git invocations where n = agent count.

The system prompt is loaded from `configs/council-system-prompt.md` with per-agent placeholder substitution (`{{emoji}}`, `{{name}}`, `{{persona}}`, `{{workDir}}`, `{{otherBranches}}`). A hardcoded fallback is used if the file is missing.

Ensemble state is flushed to `~/.openclaw/ensemble-logs/ensemble-<id>.json` after every round's responses. On manager restart, any ensemble recorded as `'running'` is immediately marked `'abandoned'` with a timestamp — it cannot be resumed because the subprocess tree died with the manager process.

### Validation (`src/validation.ts`)

All public tool inputs are validated before reaching business logic. Validators throw descriptive errors with field names for clean user-facing messages.

| Validator | Constraint |
|---|---|
| `validateName` | `[A-Za-z0-9._-]+`, max 100 chars, trims whitespace |
| `validateAgentName` | `[A-Za-z0-9][A-Za-z0-9-]*`, max 50 chars, git-branch-safe, no path traversal |
| `validateCwd` | Resolves to absolute path, rejects empty strings, rejects `/proc`, `/sys`, `/dev`, `/run/user` |
| `validateRegex` | Syntax check + nested quantifier detection (ReDoS guard) |
| `validatePermissionMode` | Enum: `bypassPermissions \| acceptEdits \| auto \| plan` |
| `validateEffort` | Enum: `low \| medium \| high \| xhigh \| max \| auto` |
| `validateTimeout` | 1 s–24 h range, finite number required |
| `validatePositiveInt` | Integer ≥ 1, optional upper bound |
| `validateStringField` | Max 50 000 chars (configurable per call) |
| `validateStringArray` | Max 200 items, each item must be a string |
| `validateBoolean` | Strict `typeof === 'boolean'` |

---

## Security Audit

### Threat model

Clawnductor is a **local tool** with a single-user trust model. It runs inside OpenClaw on the same machine as the user. There is no network-accessible API, no authentication surface, no database, and no multi-tenancy. The primary attack surface is:

1. Malformed inputs from OpenClaw tool calls (mitigated by strict validators)
2. Path traversal in filesystem operations (mitigated by `validateCwd`, `validateAgentName`)
3. Command injection in subprocess arguments (mitigated by using `spawn(cmd, argsArray)` — the array form, never shell interpolation)
4. Orphan processes from previous runs (mitigated by PID file with cmdline verification)

### Not applicable attack classes

| Attack | Why N/A |
|---|---|
| CSRF | No HTTP server; plugin uses IPC with OpenClaw, not web requests |
| XSS | No HTML output |
| SQLi | No SQL database |
| AuthN/AuthZ bugs | No user accounts; OS access control is the trust boundary |
| IDOR | No multi-tenancy; all ensemble/session IDs are local UUIDs |
| Session hijacking | No network sessions; sessions are local subprocesses keyed by name |

### Specific controls

**Path traversal:** Agent names pass through `validateAgentName` (`[A-Za-z0-9][A-Za-z0-9-]*`) before being embedded in filesystem paths and git branch names. A name like `../../etc` fails validation before any I/O. Working directories pass through `validateCwd`, which calls `path.resolve()` first and then checks the absolute result against forbidden prefixes.

**ReDoS:** `validateRegex` rejects patterns containing nested quantifiers (`(a+)+`, `(a*)*`, etc.) before any user-supplied pattern is compiled or used against session history.

**Command injection:** All subprocess calls use the array form of `spawn`/`execFile`. User-supplied strings (model names, prompts, system prompts) are passed as elements of an argument array, never interpolated into a shell string.

**PID recycling guard:** The startup orphan-cleanup code checks `/proc/<pid>/cmdline` both before SIGTERM and before the delayed SIGKILL (3 s later) to prevent killing a recycled PID that now belongs to a different process.

**Duplicate session names:** Restarting a session with an existing active name stops the old subprocess atomically before creating the replacement. This prevents ghost subprocesses and ensures the subprocess count stays accurate against the concurrency cap.

**Ensemble ID isolation:** Each ensemble and plan ID is a `randomUUID()` (v4). These are opaque to callers and unguessable.

**`maxBudgetUsd`:** Accepted in `EnsembleConfig` for forward compatibility but not yet enforced. Treat it as a documentation field until wired to actual cost tracking.

**`bare` session flag:** Accepted in `SessionConfig` for ensemble agent sessions (intent: skip hooks and CLAUDE.md for headless operation) but not yet mapped to a corresponding Claude CLI flag. Currently a no-op; the permissionMode `bypassPermissions` provides the permission-skipping behavior.

### Trust boundary

The plugin executes inside OpenClaw's process. The primary trust boundary is the OpenClaw plugin sandbox, which requires the `childProcess: true` capability declaration in `openclaw.plugin.json` and is installed with `--dangerously-force-unsafe-install` because of that capability. Users who install this plugin are explicitly granting subprocess execution rights on their machine.

Claude API keys are managed by the `claude` CLI subprocess. Clawnductor never reads, stores, or transmits them.

---

## Technology Choices

### Zero runtime dependencies

Every feature is implemented with Node.js built-ins:

| Module | Use |
|---|---|
| `node:child_process` | Claude subprocess (`spawn`), git commands (`spawn`), project purge (`execFile`) |
| `node:readline` | Line-by-line parsing of stream-JSON stdout |
| `node:fs` | Session persistence, PID file, plan.md, ensemble logs |
| `node:path` | Path resolution and worktree path construction |
| `node:crypto` | `randomUUID()` for ensemble IDs |
| `node:events` | `EventEmitter` base for `PersistentClaudeSession` and `Ensemble` |
| `node:util` | `promisify(execFile)` for one-shot `claude project purge` call |

**Why no external deps?** OpenClaw's security scanner flags symlinks that escape the package root. `npm install` with any file-path dependency creates symlinks in `node_modules/.bin/` that point outside the project, which OpenClaw rejects. Building from scratch eliminates this class of problem entirely and keeps the install footprint minimal. The distributed package contains only compiled `dist/` output and the `configs/` and `skills/` directories.

### TypeScript ESM with NodeNext

`"module": "NodeNext"` and `"moduleResolution": "NodeNext"` enforce that every import specifier ends in `.js` (the compiled output extension). This matches Node.js's native ESM loader behavior and avoids the path-aliasing hacks needed with other module strategies. Strict mode is on; all types are explicit.

### Claude's `stream-json` protocol

The `--input-format stream-json --output-format stream-json --replay-user-messages` flag combination keeps Claude in a multi-turn conversation loop:

- `--replay-user-messages` tells Claude to replay all user messages when resuming, maintaining conversation coherence
- `--include-partial-messages` emits assistant content blocks as they stream, enabling chunk forwarding to callers
- `--verbose` includes token usage and cost stats in `result` events

### `bypassPermissions` as default

Claude Code sessions default to `--permission-mode bypassPermissions`. This is intentional: autonomous agents inside an ensemble cannot pause to ask for user confirmation — they need to read, write, and run commands without interruption. Users who need approval gates can set `permissionMode: 'acceptEdits'` per session.

### CircuitBreaker pattern

The `CircuitBreaker` class inside `SessionManager` prevents runaway subprocess spawning when the Claude binary is unavailable or repeatedly crashing. After 3 consecutive session-start failures, new sessions are rejected for an exponentially increasing backoff period (base 1 s, max 5 min). The breaker resets automatically on the first success.

---

## Tool Reference

### Jam (single-session)

| Tool | Description |
|---|---|
| `jam_start` | Start a persistent Claude Code session. Returns a name used by all other `jam_*` tools. |
| `jam_play` | Send a prompt, get a response. Supports streaming (`stream: true`) and plan mode. |
| `jam_end` | Stop the session and free the subprocess. |
| `jam_list` | List all active sessions and persisted session IDs on disk. |
| `jam_status` | Detailed stats: context %, tokens in/out, cost, retries, uptime. |
| `jam_groove` | Search session history with a regex. |
| `jam_bridge` | Compact the context window via `/compact`. |
| `jam_transpose` | Switch model mid-session with `--resume` to preserve history. |
| `jam_rekey` | Add/remove/replace allowed or disallowed tools, restarted with `--resume`. |
| `jam_roster` | List agent definitions from `.claude/agents/` in a project directory. |
| `bandstand` | Health overview of all active sessions. |

### Ensemble (multi-agent)

| Tool | Description |
|---|---|
| `ensemble_start` | Start a multi-agent ensemble. Returns an `id` to poll. |
| `ensemble_status` | Get current round, responses, and consensus votes. |
| `ensemble_abort` | Stop all agent sessions and terminate. |
| `ensemble_cue` | Inject a user message into all agents' next-round prompts. |
| `ensemble_score` | Review output: changed files, branches, plan.md, per-agent summaries. |
| `ensemble_accept` | Accept work; removes worktrees, branches, plan.md, and reviews/. |
| `ensemble_reject` | Reject with feedback; rewrites plan.md for retry. Preserves worktrees. |

### Overture / Finale

| Tool | Description |
|---|---|
| `overture_start` | Deep planning: an Opus agent explores your codebase and produces a detailed plan. |
| `overture_status` | Get plan text once the overture completes. |
| `finale_start` | Fleet code review: up to 20 specialized reviewer agents run in parallel. |
| `finale_status` | Get synthesized findings from all reviewers. |

### Stage

| Tool | Description |
|---|---|
| `purge_stage` | Run `claude project purge` to wipe transcripts and tasks. Defaults to dry-run. |

---

## Deployment

### Prerequisites

- Node.js 22+ (`node --version`)
- `claude` CLI installed and authenticated (`claude --version && claude whoami`)
- OpenClaw installed (`openclaw --version`)

### First-time install

```sh
cd /path/to/clawnductor
npm install           # installs devDependencies (TypeScript + @types/node only)
npm run build         # compiles TypeScript → dist/
npm pack              # produces clawnductor-x.y.z.tgz
openclaw plugins install clawnductor-*.tgz --dangerously-force-unsafe-install
openclaw plugins enable clawnductor
```

The `--dangerously-force-unsafe-install` flag is required because this plugin declares `childProcess: true` capability (it spawns Claude subprocesses). OpenClaw shows a warning at install time; this is expected.

### Reinstall after code changes

```sh
npm run build && npm pack && openclaw plugins install clawnductor-*.tgz --dangerously-force-unsafe-install --force && openclaw plugins enable clawnductor
```

`publish.sh` at the repo root automates this flow.

### Publishing to npm

```sh
npm version patch   # or minor/major
npm run build
npm publish
```

### Configuration

Set these in OpenClaw's plugin configuration for `clawnductor`:

| Key | Default | Description |
|---|---|---|
| `claudeBin` | `claude` | Path to the Claude CLI binary (useful if `claude` isn't on PATH) |
| `defaultModel` | (none) | Default model; individual sessions can override |
| `defaultPermissionMode` | `bypassPermissions` | Permission mode for all sessions unless overridden |
| `maxConcurrentSessions` | `5` | Hard cap on simultaneous Claude subprocesses |
| `sessionTtlMinutes` | `120` | Idle sessions are evicted after this many minutes |

### Running tests

```sh
npm test
```

Runs `tsc` (type-check + compile) then `node --test dist/tests/*.test.js` using Node.js 22's built-in test runner. No external test framework required.

---

## Things to Be Mindful Of

### Process resource cost

Each active jam session is a live `claude` subprocess. On constrained hardware (Jetson boards, low-RAM VMs), lower `maxConcurrentSessions` to 2–3 and keep `sessionTtlMinutes` short to avoid memory pressure.

Ensemble agents are additional subprocesses — a 3-agent ensemble plus 1 jam session = 4 simultaneous Claude processes. Plan accordingly.

### Ensemble worktree cleanup

Worktrees are only removed when `ensemble_accept` is called. If the process crashes mid-ensemble, worktrees at `<projectDir>/.worktrees/` must be cleaned up manually:

```sh
git worktree list
git worktree remove --force .worktrees/<AgentName>
git branch -D ensemble/<AgentName>
```

An ensemble loaded from disk with `status: 'abandoned'` was interrupted mid-run; its worktrees may still exist and should be inspected before cleanup.

### Session persistence is best-effort

The claude CLI's `--resume <session_id>` flag relies on Anthropic's session storage. If Anthropic's servers prune the session history (their own TTL), resumption silently starts a fresh conversation. Treat `claudeSessionId` as a hint, not a guarantee.

### Consensus parsing

The consensus vote `[CONSENSUS: YES/NO]` is detected by regex against the agent's text output. The parser takes the first match. A creative prompt could produce multiple markers — only the first is used. Validate ensemble outputs with `ensemble_score` before calling `ensemble_accept`.

### Git config required for ensemble commits

Ensemble commits require `user.email` and `user.name` in the project's git config. If unset, `git commit` will fail, the agent will receive an error, and the round will likely produce a `[CONSENSUS: NO]`. Set them with:

```sh
git -C /path/to/project config user.email "agent@ensemble.local"
git -C /path/to/project config user.name "Ensemble"
```

Or set them globally: `git config --global user.email ...`

### Ultraplan / Ultrareview result TTL

Overture and finale results are held in memory for 30 minutes after completion, then evicted. If `overture_status` / `finale_status` returns not-found, the result TTL has expired. Re-run to generate fresh results.

### The `maxBudgetUsd` field is not enforced

`EnsembleConfig.maxBudgetUsd` is accepted by the type system and stored, but no cost-tracking enforcement is wired. Each agent turn accumulates cost in `session.getStats().costUsd`, but the ensemble does not abort when a budget is exceeded. This is a known limitation.

---

## File Map

```
clawnductor/
├── src/
│   ├── index.ts           — plugin entry point, 23 tool registrations
│   ├── types.ts           — shared types, constants, MODEL_ALIASES
│   ├── session.ts         — PersistentClaudeSession subprocess wrapper + buildArgs()
│   ├── session-manager.ts — SessionManager, CircuitBreaker, reviewer fleet definitions
│   ├── ensemble.ts        — Ensemble, parseConsensus(), buildRoundPrompt()
│   └── validation.ts      — all input validators
├── tests/
│   ├── validation.test.ts      — 42 validator tests
│   ├── session.test.ts         — 17 buildArgs() tests
│   ├── ensemble.test.ts        — 20 parseConsensus + buildRoundPrompt tests
│   ├── circuit-breaker.test.ts — 6 CircuitBreaker behavior tests
│   └── session-manager.test.ts — 22 SessionManager pure-logic tests
├── configs/
│   └── council-system-prompt.md — agent system prompt (loaded at runtime)
├── skills/
│   └── SKILL.md           — OpenClaw skill reference docs
├── openclaw.plugin.json   — plugin manifest (capabilities, contracts, configSchema)
├── package.json
├── tsconfig.json
├── publish.sh             — build → pack → openclaw install one-liner
└── JOURNAL.md             — this file
```
