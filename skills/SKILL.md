# Clawnductor

Clawnductor exposes Claude Code as a programmable coding runtime inside OpenClaw.

## When to use these tools

Use **jam_*** tools when you want a single Claude Code agent to work on a task that will take more than one message. The session keeps its full context and tool history between calls — you don't re-spawn Claude each time.

Use **ensemble_*** tools when the task is large enough to benefit from parallel agents: multiple independent modules, competing design approaches, or a code + review split.

Use **overture_*** when you want a thorough implementation plan before committing to any code changes. Let it run for up to 30 minutes.

Use **finale_*** to run a fleet of specialized bug-hunters across a codebase before shipping.

## Quick reference

| Tool | Purpose |
|------|---------|
| `jam_start` | Start a persistent Claude Code session |
| `jam_play` | Send a prompt to that session |
| `jam_end` | Stop the session |
| `jam_list` | List all sessions |
| `jam_status` | Detailed status (context %, cost, retries) |
| `bandstand` | Health overview of all sessions |
| `jam_groove` | Regex-search session history |
| `jam_bridge` | Compact context to free up space |
| `jam_transpose` | Switch model mid-session |
| `jam_rekey` | Update tool permissions mid-session |
| `jam_roster` | List .claude/agents/ definitions |
| `ensemble_start` | Start a multi-agent ensemble |
| `ensemble_status` | Poll ensemble progress |
| `ensemble_abort` | Kill an ensemble |
| `ensemble_cue` | Inject a message into all agents |
| `ensemble_score` | Review ensemble output |
| `ensemble_accept` | Accept work, clean up scaffolding |
| `ensemble_reject` | Reject work, rewrite plan with feedback |
| `overture_start` | Start a deep planning session |
| `overture_status` | Get plan when done |
| `finale_start` | Launch fleet code review |
| `finale_status` | Get review findings |
| `purge_stage` | Wipe Claude Code project state |

## Typical flows

### Single-agent task
```
jam_start(name="auth-fix", cwd="/project")
jam_play(name="auth-fix", message="Fix the JWT expiry bug in src/auth.ts")
# ... agent works ...
jam_status(name="auth-fix")  # check context %
jam_end(name="auth-fix")
```

### Multi-agent ensemble
```
ensemble_start(task="Build REST API with auth and rate limiting", projectDir="/project")
# poll every 30s:
ensemble_status(id="...")
# when status is consensus or max_rounds:
ensemble_score(id="...")
ensemble_accept(id="...")  # or ensemble_reject with feedback
```

### Plan then implement
```
overture_start(task="Add OAuth2 support with Google + GitHub", cwd="/project")
# wait ~10-30 min:
overture_status(id="...")  # returns plan text when done
# use the plan to guide a jam or ensemble
```
