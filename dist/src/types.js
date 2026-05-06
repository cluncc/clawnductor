export const MODEL_ALIASES = {
    opus: 'claude-opus-4-7',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5-20251001',
};
export function resolveModelAlias(model) {
    return MODEL_ALIASES[model.toLowerCase()] ?? model;
}
// ─── Constants ────────────────────────────────────────────────────────────────
export const CONTEXT_WINDOW_TOKENS = 200_000;
export const SESSION_READY_TIMEOUT_MS = 20_000;
export const TURN_TIMEOUT_MS = 300_000;
export const COMPACT_TIMEOUT_MS = 120_000;
export const STOP_SIGKILL_DELAY_MS = 3_000;
export const MAX_HISTORY_EVENTS = 500;
export const DEFAULT_SESSION_TTL_MINUTES = 120;
export const DISK_TTL_DAYS = 7;
export const CIRCUIT_BREAKER_THRESHOLD = 3;
export const CIRCUIT_BREAKER_BACKOFF_BASE_MS = 1_000;
export const CIRCUIT_BREAKER_MAX_BACKOFF_MS = 5 * 60_000;
export const DEFAULT_MAX_ROUNDS = 15;
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_MAX_TURNS_PER_AGENT = 30;
export const INTER_ROUND_DELAY_MS = 2_000;
export const ENSEMBLE_RESULT_TTL_MS = 30 * 60_000;
export const GIT_CMD_TIMEOUT_MS = 30_000;
export const WORKTREE_DIR = '.worktrees';
export const ULTRAPLAN_TIMEOUT_MS = 30 * 60_000;
export const ULTRAPLAN_RESULT_TTL_MS = 30 * 60_000;
export const ULTRAREVIEW_RESULT_TTL_MS = 30 * 60_000;
//# sourceMappingURL=types.js.map