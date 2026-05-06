import { EventEmitter } from 'node:events';
import { type AgentPersona, type EnsembleSession, type EnsembleReviewResult, type EnsembleAcceptResult, type EnsembleRejectResult } from './types.js';
export declare function parseConsensus(text: string): boolean | null;
export declare class Ensemble extends EventEmitter {
    readonly session: EnsembleSession;
    private _agentSessions;
    private _aborted;
    private claudeBin;
    private _injected;
    private log;
    constructor(session: EnsembleSession, claudeBin: string, log?: (msg: string) => void);
    get id(): string;
    private _killProcesses;
    abort(): void;
    inject(message: string): void;
    run(): Promise<void>;
    private _runRound;
    private _runAgent;
    private _setupWorktrees;
    review(): Promise<EnsembleReviewResult>;
    accept(): Promise<EnsembleAcceptResult>;
    reject(feedback: string): Promise<EnsembleRejectResult>;
    private _readPlan;
    private _getGitLog;
    private _logPath;
    private _flushLog;
}
export declare function buildRoundPrompt(round: number, task: string, plan: string | null, gitLog: string, injected: string[], agent: AgentPersona, branchName: string): string;
//# sourceMappingURL=ensemble.d.ts.map