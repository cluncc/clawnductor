export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'auto' | 'plan';
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model.toLowerCase()] ?? model;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionConfig {
  name: string;
  cwd: string;
  model?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  appendSystemPrompt?: string;
  bare?: boolean;
  worktree?: string | boolean;
  resumeSessionId?: string;
  forkSession?: boolean;
  mcpConfig?: string | string[];
  noSessionPersistence?: boolean;
}

export interface SessionStats {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  isReady: boolean;
  busy: boolean;
  startTime: string | null;
  lastActivity: string | null;
  contextPercent: number;
  retries: number;
  lastRetryError?: string;
  lastOutput?: string;
  lastError?: string;
}

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface SendResult {
  output: string;
  sessionId?: string;
  error?: string;
  events: StreamEvent[];
}

export interface SessionInfo {
  name: string;
  claudeSessionId?: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  created: string;
  stats: SessionStats;
  paused: boolean;
  busy: boolean;
}

export interface PersistedSession {
  name: string;
  claudeSessionId: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  created: string;
  lastActivity: number;
}

export interface AgentInfo {
  name: string;
  file: string;
  description: string;
}

// ─── Ensemble ─────────────────────────────────────────────────────────────────

export interface AgentPersona {
  name: string;
  emoji: string;
  persona: string;
  model?: string;
  permissionMode?: PermissionMode;
}

export interface EnsembleConfig {
  agents: AgentPersona[];
  maxRounds: number;
  projectDir: string;
  agentTimeoutMs?: number;
  maxTurnsPerAgent?: number;
  maxBudgetUsd?: number;
  defaultPermissionMode?: PermissionMode;
}

export interface AgentResponse {
  agent: string;
  round: number;
  content: string;
  consensus: boolean;
  timestamp: string;
}

export type EnsembleStatus =
  | 'running'
  | 'consensus'
  | 'max_rounds'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'abandoned';

export interface EnsembleSession {
  id: string;
  task: string;
  config: EnsembleConfig;
  responses: AgentResponse[];
  status: EnsembleStatus;
  round: number;
  startTime: string;
  endTime?: string;
  error?: string;
}

export interface EnsembleChangedFile {
  file: string;
  insertions: number;
  deletions: number;
}

export interface EnsembleReviewResult {
  ensembleId: string;
  projectDir: string;
  status: EnsembleStatus;
  rounds: number;
  planExists: boolean;
  planContent?: string;
  changedFiles: EnsembleChangedFile[];
  branches: string[];
  worktrees: string[];
  agentSummaries: Array<{ agent: string; consensus: boolean; preview: string }>;
}

export interface EnsembleAcceptResult {
  ensembleId: string;
  branchesDeleted: string[];
  worktreesRemoved: string[];
  planDeleted: boolean;
}

export interface EnsembleRejectResult {
  ensembleId: string;
  planRewritten: boolean;
  feedback: string;
}

// ─── Ultraplan / Ultrareview ──────────────────────────────────────────────────

export interface UltraplanResult {
  id: string;
  status: 'running' | 'completed' | 'error' | 'timeout';
  plan?: string;
  sessionName: string;
  startTime: string;
  endTime?: string;
  error?: string;
}

export interface UltrareviewResult {
  id: string;
  status: 'running' | 'completed' | 'error';
  ensembleId: string;
  findings?: string;
  agentCount: number;
  startTime: string;
  endTime?: string;
  error?: string;
}

// ─── Plugin Config ────────────────────────────────────────────────────────────

export interface PluginConfig {
  claudeBin: string;
  defaultModel?: string;
  defaultPermissionMode: PermissionMode;
  maxConcurrentSessions: number;
  sessionTtlMinutes: number;
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
