# Clawnductor — Engineering Journal

## What Is This

Clawnductor is an [OpenClaw](https://openclaw.dev) plugin that turns Claude Code into a programmable multi-agent system. From inside OpenClaw you can start persistent Claude Code subprocesses, assemble ensembles of agents that collaborate over git worktrees, launch deep planning runs, and dispatch fleets of specialized code reviewers.

The name is a portmanteau: **Claude** + **conductor** (the person who directs an ensemble). Every public-facing identifier follows a music pun theme: `jam_*` for single sessions, `bandstand` for the health dashboard, `ensemble_*` for multi-agent councils, `overture_*` for deep planning, and `finale_*` for fleet code review.

---

## Architecture

### Plugin entry point (`src/index.ts`)

OpenClaw plugins export a default object with a `register(api)` method. The plugin lazily constructs a `SessionManager` on first tool use and routes 23 registered tools to the appropriate manager methods. The `ClawApi` interface type is declared locally — no OpenClaw types are imported at runtime, which keeps the package free of peer-dependency coupling.

All tool inputs pass through `src/validation.ts` before reaching business logic.

### Session layer (`src/session.ts`)

`PersistentClaudeSession` wraps a `claude -p --input-format stream-json --output-format stream-json` subprocess as a persistent event emitter. One instance = one long-lived subprocess that accepts multi-turn conversations.

**Protocol:**
- Stdin: newline-delimited JSON `{"type":"user","message":{...}}`
- Stdout: newline-delimited JSON events — `system/init` (carries `session_id`), `assistant` (content + usage), `result/success` or `result/error` (end of turn + cost)

**Key design decisions:**
- `start()` waits for `system/init` (or a 20-second fallback timeout) before resolving, so callers always get a ready session
- A single `_resolve`/`_reject` pair manages one in-flight turn; concurrent calls are rejected with "Session is busy"
- `'chunk'` events are forwarded to callers while the turn is in progress (streaming)
- `'turn-end'` cleans up the chunk listener regardless of success/failure

### Session manager (`src/session-manager.ts`)

`SessionManager` is the central state machine:

| Concern | Mechanism |
|---|---|
| Session registry | `Map<name, SessionRecord>` (in-memory) |
| Session persistence | `~/.openclaw/clawnductor-sessions.json` (7-day disk TTL) |
| Orphan cleanup | PID file at `~/.openclaw/clawnductor-pids.json` |
| Memory TTL | Configurable, defaults 120 min; GC runs every 60 s |
| Concurrent session cap | `maxConcurrentSessions` (default 5) |
| Fault tolerance | `CircuitBreaker` — 3 consecutive failures trigger exponential backoff (1 s × 2ⁿ, max 5 min) |

**`switchModel` and `updateTools`** restart the session with `--resume <sessionId>` to preserve conversation history. Both implement rollback: the old session is only stopped after the new one is confirmed started.

**Ultrareview** dispatches up to 20 specialized reviewer agents as a council and polls for completion using a tracked `setInterval`. Pollers are stored in `_reviewPollers` so `shutdown()` can clear them.

### Council — multi-agent ensembles (`src/council.ts`)

A `Council` coordinates a set of `AgentPersona` definitions through rounds:

1. **Round 1 (Scoring):** Every agent writes `plan.md` in the project root. No code changes allowed.
2. **Round 2+ (Implementation):** Agents claim `- [ ]` checkboxes, implement, commit, and merge to main.
3. **Consensus:** All agents voting `[CONSENSUS: YES]` ends the council. Max rounds is a safety cap.

Each agent gets an isolated git worktree at `<projectDir>/.worktrees/<AgentName>` on branch `council/<AgentName>`. Worktrees let agents write code without interfering with each other. The main branch is the merge target.

The system prompt is loaded from `configs/council-system-prompt.md` with per-agent placeholder substitution (`{{emoji}}`, `{{name}}`, `{{persona}}`, `{{workDir}}`, `{{otherBranches}}`). A hardcoded fallback is used if the file is missing.

Transcripts are written to `~/.openclaw/council-logs/` at the end of every run.

### Validation (`src/validation.ts`)

All public tool inputs are validated before reaching business logic. Validators:

- `validateName` — session names: `[A-Za-z0-9._-]+`, max 100 chars
- `validateAgentName` — agent names: `[A-Za-z0-9][A-Za-z0-9-]*`, max 50 chars, git-branch-safe, no path traversal
- `validateCwd` — resolves to absolute path, rejects `/proc`, `/sys`, `/dev`, `/run/user`
- `validateRegex` — syntax check + nested quantifier detection (ReDoS guard)
- `validatePermissionMode` — enum: `bypassPermissions | acceptEdits | auto | plan`
- `validateEffort` — enum: `low | medium | high | xhigh | max | auto`
- `validateTimeout` — 1 s–24 h range
- `validatePositiveInt`, `validateStringField`, `validateStringArray`, `validateBoolean`

---

## Security Audit

### What was reviewed

1. **Input validation** — all 23 tool handlers now validate every argument before use
2. **Path traversal** — agent names sanitized via `validateAgentName` before use in filesystem paths and git branch names; `validateCwd` rejects system paths
3. **ReDoS** — `validateRegex` rejects nested quantifiers before any user pattern is compiled
4. **PID recycling** — `_cleanupOrphanPids` checks `/proc/<pid>/cmdline` to verify the process is actually a Claude binary before sending SIGTERM
5. **Race conditions in session swap** — `switchModel`/`updateTools` now restore the old session on failure (rollback)
6. **Timer leaks** — ultrareview pollers are tracked in `_reviewPollers` and cleared on shutdown
7. **Session persistence** — removed an inverted condition (`!this.config.defaultModel`) that was silently preventing sessions from being persisted

### What this plugin does NOT do

- **No authentication or authorization** — OpenClaw manages API surface access; this plugin has no user concept
- **No SQL** — no database, no injection surface
- **No HTTP server** — no CSRF surface (though `api.registerHttpRoute` exists, we don't use it)
- **No XSS** — no HTML output
- **No secrets stored** — Claude's API key is managed by the `claude` CLI subprocess, never touched here

### Trust boundary

The plugin executes inside OpenClaw's process. The primary trust boundary is the OpenClaw plugin sandbox, which requires `childProcess: true` capability declaration and is installed with `--dangerously-force-unsafe-install` because of that capability. Users who install this plugin are explicitly granting subprocess execution rights.

---

## Technology Choices

### Zero runtime dependencies

Every feature is implemented with Node.js built-ins:

| Module | Use |
|---|---|
| `node:child_process` | Claude subprocess, git commands |
| `node:readline` | Line-by-line parsing of stream-JSON output |
| `node:fs` | Session persistence, PID file, plan.md, transcripts |
| `node:path` | Path resolution and worktree path construction |
| `node:crypto` | `randomUUID()` for council/plan/review IDs |
| `node:events` | `EventEmitter` base for session and council |
| `node:util` | `promisify(execFile)` for one-shot git commands |

**Why no external deps?** OpenClaw's security scanner flags symlinks that escape the package root. `npm install` with any file-path dependency creates symlinks in `node_modules/.bin/` that point outside the project, which OpenClaw rejects. Building from scratch eliminates this class of problem entirely and keeps the install footprint minimal.

### TypeScript ESM with NodeNext

`"module": "NodeNext"` and `"moduleResolution": "NodeNext"` enforce that every import specifier ends in `.js` (the compiled output extension). This matches Node.js's native ESM loader behavior and avoids the path-aliasing hacks needed with other module strategies.

### Claude's `stream-json` protocol

The `--input-format stream-json --output-format stream-json --replay-user-messages` flag combination keeps Claude in a multi-turn conversation loop:
- `--replay-user-messages` — tells Claude to replay all user messages when resuming, maintaining conversation coherence
- `--include-partial-messages` — emits assistant content blocks as they stream, enabling chunk forwarding
- `--verbose` — includes usage stats (tokens, cost) in result events

### `bypassPermissions` as default

Claude Code sessions default to `--permission-mode bypassPermissions`. This is intentional: autonomous agents inside a council cannot pause to ask for user confirmation — they need to be able to read, write, and run commands without interruption. Users who need approval gates can set `permissionMode: 'acceptEdits'` per-session.

---

## Deployment

### Prerequisites

- Node.js 22+ (`node --version`)
- `claude` CLI installed and authenticated (`claude --version`)
- OpenClaw installed (`openclaw --version`)

### First-time install

```sh
cd /path/to/clawnductor
npm install           # installs devDependencies (TypeScript types only)
npm run build         # compiles TypeScript → dist/
npm pack              # produces clawnductor-1.0.0.tgz (respects "files" field, no node_modules)
openclaw plugins install clawnductor-1.0.0.tgz --dangerously-force-unsafe-install
openclaw plugins enable clawnductor
```

The `--dangerously-force-unsafe-install` flag is required because this plugin uses `child_process` to spawn Claude subprocesses. OpenClaw shows a warning; this is expected.

### Reinstall after changes

```sh
npm run build && npm pack && openclaw plugins install clawnductor-*.tgz --dangerously-force-unsafe-install --force && openclaw plugins enable clawnductor
```

`publish.sh` at the repo root automates this.

### Configuration

Optional keys in OpenClaw's plugin config for `clawnductor`:

| Key | Default | Description |
|---|---|---|
| `claudeBin` | `claude` | Path to the Claude CLI binary |
| `defaultModel` | (none) | Model to use if not specified per-session |
| `defaultPermissionMode` | `bypassPermissions` | Permission mode for all sessions |
| `maxConcurrentSessions` | `5` | Hard cap on simultaneous subprocess count |
| `sessionTtlMinutes` | `120` | Idle session eviction timeout |

### Running tests

```sh
npm test
```

This runs `tsc` (type-check + compile) then `node --test dist/tests/*.test.js` using Node.js 22's native test runner. No external test framework is required.

---

## Known Limitations and Things to Be Mindful Of

### Process resource cost

Each active jam session is a live `claude` subprocess. On constrained hardware (e.g., Jetson boards), you may want to lower `maxConcurrentSessions` to 2–3 and keep the session TTL short.

### Council worktree cleanup

Worktrees are only removed when `ensemble_accept` is called. If the process crashes mid-council, worktrees at `<projectDir>/.worktrees/` must be cleaned up manually:
```sh
git worktree list
git worktree remove --force .worktrees/<AgentName>
git branch -D council/<AgentName>
```

### Session persistence limitations

The claude CLI's `--resume <session_id>` flag is best-effort. If Anthropic's servers prune the session history (TTL on their side), resumption silently starts a fresh conversation. Callers should treat `claudeSessionId` as a hint, not a guarantee.

### Consensus parsing is text-only

The consensus vote (`[CONSENSUS: YES/NO]`) is parsed by regex from the agent's text output. A sufficiently creative agent could embed multiple markers. The parser uses the first match — it does not validate that exactly one marker is present.

### Git config required for councils

Council commits require `user.email` and `user.name` to be set in the git config of the project directory. If they aren't set, `git commit` will fail silently (the error is caught and ignored to avoid blocking the run).

---

## File Map

```
clawnductor/
├── src/
│   ├── index.ts          — plugin entry point, tool registration
│   ├── types.ts          — shared types and constants
│   ├── session.ts        — PersistentClaudeSession subprocess wrapper
│   ├── session-manager.ts — SessionManager, CircuitBreaker, reviewer fleet
│   ├── council.ts        — Council (multi-agent ensemble)
│   └── validation.ts     — input validation and sanitization
├── tests/
│   ├── validation.test.ts      — 35 validation function tests
│   ├── session.test.ts         — 17 buildArgs tests
│   ├── council.test.ts         — 7 parseConsensus tests
│   └── circuit-breaker.test.ts — 6 circuit breaker tests
├── configs/
│   └── council-system-prompt.md — agent charter (loaded at runtime)
├── skills/
│   └── SKILL.md          — OpenClaw skill docs
├── openclaw.plugin.json  — plugin manifest
├── package.json
├── tsconfig.json
├── publish.sh
└── JOURNAL.md            — this file
```
