export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'auto' | 'plan';
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
export declare const MODEL_ALIASES: Record<string, string>;
export declare function resolveModelAlias(model: string): string;
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
export type EnsembleStatus = 'running' | 'consensus' | 'max_rounds' | 'error' | 'accepted' | 'rejected' | 'abandoned';
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
    agentPids?: Record<string, number>;
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
    agentSummaries: Array<{
        agent: string;
        consensus: boolean;
        preview: string;
    }>;
}
export interface EnsembleAcceptResult {
    ensembleId: string;
    mergedBranches: string[];
    mergeFailed: string[];
    branchesDeleted: string[];
    worktreesRemoved: string[];
    planDeleted: boolean;
}
export interface EnsembleRejectResult {
    ensembleId: string;
    planRewritten: boolean;
    feedback: string;
}
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
export interface PluginConfig {
    claudeBin: string;
    defaultModel?: string;
    defaultPermissionMode: PermissionMode;
    maxConcurrentSessions: number;
    sessionTtlMinutes: number;
}
export declare const CONTEXT_WINDOW_TOKENS = 200000;
export declare const SESSION_READY_TIMEOUT_MS = 20000;
export declare const TURN_TIMEOUT_MS = 300000;
export declare const COMPACT_TIMEOUT_MS = 120000;
export declare const STOP_SIGKILL_DELAY_MS = 3000;
export declare const MAX_HISTORY_EVENTS = 500;
export declare const DEFAULT_SESSION_TTL_MINUTES = 120;
export declare const DISK_TTL_DAYS = 7;
export declare const CIRCUIT_BREAKER_THRESHOLD = 3;
export declare const CIRCUIT_BREAKER_BACKOFF_BASE_MS = 1000;
export declare const CIRCUIT_BREAKER_MAX_BACKOFF_MS: number;
export declare const DEFAULT_MAX_ROUNDS = 15;
export declare const DEFAULT_AGENT_TIMEOUT_MS: number;
export declare const DEFAULT_MAX_TURNS_PER_AGENT = 30;
export declare const INTER_ROUND_DELAY_MS = 2000;
export declare const ENSEMBLE_RESULT_TTL_MS: number;
export declare const GIT_CMD_TIMEOUT_MS = 30000;
export declare const WORKTREE_DIR = ".worktrees";
export declare const ULTRAPLAN_TIMEOUT_MS: number;
export declare const ULTRAPLAN_RESULT_TTL_MS: number;
export declare const ULTRAREVIEW_RESULT_TTL_MS: number;
//# sourceMappingURL=types.d.ts.map