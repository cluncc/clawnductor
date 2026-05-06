# Clawnductor

**Weaponize Claude Code from [OpenClaw](https://openclaw.dev) into a programmable multi-agent system.**

Persistent headless coding sessions, multi-agent ensembles over git worktrees, deep planning runs, and fleet code reviews — all wired as first-class OpenClaw tools.

> The name is a portmanteau: **Claude** + **conductor** (the person who directs an ensemble).

## What It Does

Clawnductor turns a single Claude Code binary into a fleet of coordinated agents:

- **Persistent sessions** — long-lived Claude Code subprocesses that survive across API calls. Send multi-turn conversations, stream responses, hot-swap models and tools mid-session.
- **Multi-agent ensembles** — spawn 3–20 agents that work in parallel git worktrees, vote on completion, and merge to main. The Composer/Performer/Critic pattern out of the box.
- **Deep planning** — launch an Opus agent to explore a codebase thoroughly and produce a detailed implementation plan.
- **Fleet review** — dispatch specialized code reviewers (security, logic, performance, API, types, concurrency) in parallel.

## Tools

Every public-facing tool follows a music pun theme.

| Tool | Purpose |
|---|---|
| `jam_start` / `jam_play` / `jam_end` | Start, send to, and stop a persistent Claude Code session |
| `jam_status` / `jam_groove` / `jam_bridge` | Session health, event search, and context compaction |
| `jam_transpose` / `jam_rekey` / `jam_roster` | Hot-swap model, update tool allowlists, list agent definitions |
| `bandstand` | Dashboard: readiness, busy/paused state, cost, context for every active session |
| `ensemble_start` | Launch a multi-agent ensemble with parallel worktrees |
| `ensemble_status` / `ensemble_abort` / `ensemble_accept` | Poll, terminate, or accept the ensemble's merged output |
| `ensemble_cue` / `ensemble_score` / `ensemble_reject` | Inject a message to all agents, review output, or reject with feedback |
| `overture_start` / `overture_status` | Deep planning run in a background Opus agent |
| `finale_start` / `finale_status` | Dispatch a fleet of specialized code reviewers |
| `purge_stage` | Wipe Claude Code project state (dry run or destructive) |

## Architecture

```
src/
├── index.ts            ← Plugin entry point (register tools with OpenClaw)
├── session.ts          ← PersistentClaudeSession — wraps claude subprocess
├── session-manager.ts  ← SessionManager — registry, persistence, ensembles, circuit breaker
├── ensemble.ts         ← Ensemble — worktree orchestration, round-based collaboration
├── types.ts            ← All TypeScript interfaces and runtime constants
└── validation.ts       ← Input validation (regex, enum, range checks)

configs/
└── council-system-prompt.md  ← Ensemble system prompt template

skills/
└── SKILL.md                    ← Skill definition
```

### Wire Protocol

Each `PersistentClaudeSession` communicates with Claude Code via stream-json:

- **Stdin** — `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..." }]}}`
- **Stdout** — newline-delimited JSON events: `system/init`, `assistant`, `result/success`, `result/error`

### Session Management

| Concern | Mechanism |
|---|---|
| Registry | `Map<name, SessionRecord>` (in-memory) |
| Persistence | `~/.openclaw/clawnductor-sessions.json` (7-day disk TTL) |
| Orphan cleanup | PID file survives restarts; surviving PIDs get SIGTERM → SIGKILL |
| Memory TTL | Configurable, default 120 min; GC every 60 s |
| Concurrency cap | `maxConcurrentSessions` (default 5) |
| Fault tolerance | Circuit breaker — 3 consecutive failures → exponential backoff (1 s → 5 min) |

## Installation

Clawnductor is an OpenClaw plugin. It registers itself when OpenClaw loads the extension.

```bash
# The plugin is installed as an OpenClaw extension (no npm install needed at runtime)
# OpenClaw discovers it from:
# ~/.openclaw/extensions/clawnductor

# Build TypeScript to JavaScript:
cd clawnductor
npm run build
```

**Requirements:**
- Node.js ≥ 22
- OpenClaw ≥ 2026.3
- Claude Code CLI (`claude` on PATH)

## Configuration

Configured through OpenClaw's gateway config:

```json
{
  "extensions": {
    "clawnductor": {
      "claudeBin": "claude",
      "defaultModel": "opus",
      "defaultPermissionMode": "bypassPermissions",
      "maxConcurrentSessions": 5,
      "sessionTtlMinutes": 120
    }
  }
}
```

| Field | Default | Description |
|---|---|---|
| `claudeBin` | `"claude"` | Path to Claude Code CLI |
| `defaultModel` | — | Model alias or full ID for new sessions |
| `defaultPermissionMode` | `"bypassPermissions"` | Default permission mode (`bypassPermissions` / `acceptEdits` / `auto` / `plan`) |
| `maxConcurrentSessions` | `5` | Maximum concurrent Claude Code sessions |
| `sessionTtlMinutes` | `120` | Auto-cleanup idle sessions after N minutes |

## Usage Examples

### Start a persistent coding session

```
jam_start(name="frontend", model="opus", cwd="/path/to/app")
jam_play(name="frontend", message="Build a login page with auth")
```

### Multi-agent ensemble

```
ensemble_start(
  task="Refactor the payment module to use Stripe webhooks",
  projectDir="/path/to/project",
  maxRounds=10
)
```

Three agents (Composer, Performer, Critic) work in parallel worktrees, vote on completion, and merge to main.

### Deep planning

```
overture_start(task="Design a caching layer for the API", cwd="/path/to/project")
overture_status(id="...")   // wait for the plan
```

### Fleet review

```
finale_start(projectDir="/path/to/project", agentCount=7, focus="security")
finale_status(id="...")     // get findings
```

## Session Lifecycle

```
jam_start    →   subprocess starts, waits for system/init
jam_play     →   send a message, stream response chunks
jam_bridge   →   compact context window
jam_transpose →   hot-swap model (--resume)
jam_rekey    →   update allowed/disallowed tools
jam_end      →   SIGTERM, persist state, free subprocess
```

## Ensemble Workflow

```
Round 1: Each agent writes plan.md (no business code)
Round 2+: Claim tasks, implement, commit, merge to main
Consensus: All agents vote YES → done
```

Agents get isolated git worktrees. Main branch is the merge target. Reviews happen in each round.

## Security

- Circuit breaker prevents cascade failures
- PID verification against `/proc/<pid>/cmdline` prevents PID recycling attacks
- Orphan cleanup on restart (SIGTERM → SIGKILL after 3 s)
- Network access restricted to `127.0.0.1`
- Input validation on all tool parameters

## License

All rights reserved.
