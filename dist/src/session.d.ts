import { EventEmitter } from 'node:events';
import { type SessionConfig, type SessionStats, type StreamEvent, type SendResult } from './types.js';
export declare class PersistentClaudeSession extends EventEmitter {
    readonly config: SessionConfig;
    readonly claudeBin: string;
    private proc;
    private _isReady;
    private _isPaused;
    private _isBusy;
    private _resolve;
    private _reject;
    private _turnEvents;
    private _turnText;
    private _turnTimer;
    private _lastOutput;
    private _lastError;
    sessionId?: string;
    private _stats;
    constructor(config: SessionConfig, claudeBin?: string);
    get pid(): number | undefined;
    get isReady(): boolean;
    get isPaused(): boolean;
    get isBusy(): boolean;
    getStats(): SessionStats;
    getHistory(limit?: number): Array<{
        time: string;
        type: string;
        event: StreamEvent;
    }>;
    start(): Promise<this>;
    private _onLine;
    send(message: string, opts?: {
        timeout?: number;
        onChunk?: (text: string) => void;
    }): Promise<SendResult>;
    compact(summary?: string): Promise<SendResult>;
    stop(): void;
    pause(): void;
    resume(): void;
    private _clearTurn;
}
export declare function buildArgs(cfg: SessionConfig): string[];
//# sourceMappingURL=session.d.ts.map