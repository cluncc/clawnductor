import { PersistentClaudeSession } from './session.js';
import { type SessionConfig, type SessionInfo, type PersistedSession, type SendResult, type PluginConfig, type AgentInfo, type EnsembleConfig, type EnsembleSession, type EnsembleReviewResult, type EnsembleAcceptResult, type EnsembleRejectResult, type UltraplanResult, type UltrareviewResult } from './types.js';
export declare class SessionManager {
    private sessions;
    private persisted;
    private pids;
    private cleanupTimer;
    private cb;
    private ensembles;
    private savedEnsembles;
    private ultraplans;
    private ultrareviews;
    private _reviewPollers;
    private log;
    readonly config: PluginConfig;
    constructor(raw?: Partial<PluginConfig>, log?: (msg: string) => void);
    startSession(input: Partial<SessionConfig> & {
        name?: string;
    }): Promise<SessionInfo>;
    sendMessage(name: string, message: string, opts?: {
        plan?: boolean;
        timeout?: number;
        onChunk?: (t: string) => void;
    }): Promise<SendResult>;
    stopSession(name: string): Promise<void>;
    listSessions(): SessionInfo[];
    listPersistedSessions(): PersistedSession[];
    getStatus(name: string): SessionInfo & {
        stats: ReturnType<PersistentClaudeSession['getStats']>;
    };
    grepSession(name: string, pattern: string, limit?: number): Promise<Array<{
        time: string;
        type: string;
        content: string;
    }>>;
    compactSession(name: string, summary?: string): Promise<void>;
    switchModel(name: string, model: string): Promise<SessionInfo>;
    updateTools(name: string, opts: {
        allowedTools?: string[];
        disallowedTools?: string[];
        removeTools?: string[];
        merge?: boolean;
    }): Promise<SessionInfo>;
    listAgents(cwd?: string): AgentInfo[];
    health(): object;
    ensembleStart(task: string, config: EnsembleConfig): EnsembleSession;
    ensembleStatus(id: string): EnsembleSession | undefined;
    ensembleAbort(id: string): void;
    ensembleInject(id: string, message: string): void;
    ensembleReview(id: string): Promise<EnsembleReviewResult>;
    ensembleAccept(id: string): Promise<EnsembleAcceptResult>;
    ensembleReject(id: string, feedback: string): Promise<EnsembleRejectResult>;
    ultraplanStart(task: string, opts?: {
        model?: string;
        cwd?: string;
        timeout?: number;
    }): UltraplanResult;
    private _runUltraplan;
    ultraplanStatus(id: string): UltraplanResult | undefined;
    ultrareviewStart(cwd: string, opts?: {
        agentCount?: number;
        maxDurationMinutes?: number;
        model?: string;
        focus?: string;
    }): UltrareviewResult;
    ultrareviewStatus(id: string): UltrareviewResult | undefined;
    private _synthesizeFindings;
    purgeProject(opts: {
        path?: string;
        all?: boolean;
        dryRun?: boolean;
    }): Promise<{
        stdout: string;
        stderr: string;
        dryRun: boolean;
    }>;
    shutdown(): Promise<void>;
    private _persistSession;
    private _loadPersisted;
    private _saveEnsembleState;
    private _loadEnsembles;
    private _savePids;
    private _cleanupOrphanPids;
    private _get;
    private _toInfo;
    private _gcIdleSessions;
}
//# sourceMappingURL=session-manager.d.ts.map