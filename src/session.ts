/**
 * PersistentClaudeSession
 *
 * Wraps `claude -p --input-format stream-json --output-format stream-json`
 * as a long-running subprocess. Supports multi-turn conversations, streaming
 * chunks, context compaction, and stats tracking.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import {
  type SessionConfig,
  type SessionStats,
  type StreamEvent,
  type SendResult,
  type PermissionMode,
  type EffortLevel,
  resolveModelAlias,
  CONTEXT_WINDOW_TOKENS,
  SESSION_READY_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
  COMPACT_TIMEOUT_MS,
  STOP_SIGKILL_DELAY_MS,
  MAX_HISTORY_EVENTS,
} from './types.js';

interface InternalStats {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  startTime: string | null;
  lastActivity: string | null;
  retries: number;
  lastRetryError?: string;
  history: Array<{ time: string; type: string; event: StreamEvent }>;
}

export class PersistentClaudeSession extends EventEmitter {
  readonly config: SessionConfig;
  readonly claudeBin: string;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private _isReady = false;
  private _isPaused = false;
  private _isBusy = false;

  private _resolve: ((r: SendResult) => void) | null = null;
  private _reject: ((e: Error) => void) | null = null;
  private _turnEvents: StreamEvent[] = [];
  private _turnText: string[] = [];
  private _turnTimer: ReturnType<typeof setTimeout> | null = null;

  sessionId?: string;
  private _stats: InternalStats;

  constructor(config: SessionConfig, claudeBin = process.env.CLAUDE_BIN ?? 'claude') {
    super();
    this.config = config;
    this.claudeBin = claudeBin;
    this._stats = {
      turns: 0,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0,
      startTime: null,
      lastActivity: null,
      retries: 0,
      history: [],
    };
  }

  get pid(): number | undefined { return this.proc?.pid; }
  get isReady(): boolean { return this._isReady; }
  get isPaused(): boolean { return this._isPaused; }
  get isBusy(): boolean { return this._isBusy; }

  getStats(): SessionStats {
    const total = this._stats.tokensIn + this._stats.tokensOut;
    return {
      turns: this._stats.turns,
      tokensIn: this._stats.tokensIn,
      tokensOut: this._stats.tokensOut,
      cachedTokens: this._stats.cachedTokens,
      costUsd: this._stats.costUsd,
      isReady: this._isReady,
      busy: this._isBusy,
      startTime: this._stats.startTime,
      lastActivity: this._stats.lastActivity,
      contextPercent: Math.min(100, Math.round((total / CONTEXT_WINDOW_TOKENS) * 100)),
      retries: this._stats.retries,
      lastRetryError: this._stats.lastRetryError,
    };
  }

  getHistory(limit = 50): Array<{ time: string; type: string; event: StreamEvent }> {
    return this._stats.history.slice(-limit);
  }

  // ─── Start ─────────────────────────────────────────────────────────────────

  async start(): Promise<this> {
    const args = buildArgs(this.config);

    this.proc = spawn(this.claudeBin, args, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this._stats.startTime = new Date().toISOString();

    const rl = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => this._onLine(line));

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString());
    });

    this.proc.on('close', (code) => {
      this._isReady = false;
      this._isBusy = false;
      this.emit('close', code);
      if (this._reject) {
        this._reject(new Error(`Claude exited with code ${code}`));
        this._clearTurn();
      }
    });

    this.proc.on('error', (err) => {
      this.emit('error', err);
      if (this._reject) {
        this._reject(err);
        this._clearTurn();
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Fallback: assume ready after timeout if we haven't closed
        if (this.proc && !this._isReady) {
          this._isReady = true;
        }
        resolve();
      }, SESSION_READY_TIMEOUT_MS);

      this.once('ready', () => { clearTimeout(timer); resolve(); });
      this.once('close', () => { clearTimeout(timer); reject(new Error('Closed before ready')); });
    });

    return this;
  }

  // ─── Line handler ──────────────────────────────────────────────────────────

  private _onLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }

    const now = new Date().toISOString();
    this._stats.history.push({ time: now, type: event.type, event });
    if (this._stats.history.length > MAX_HISTORY_EVENTS) {
      this._stats.history.shift();
    }
    this.emit('event', event);

    // ── system events ──
    if (event.type === 'system') {
      if (event.subtype === 'init') {
        if (event.session_id) this.sessionId = event.session_id as string;
        if (!this._isReady) {
          this._isReady = true;
          this.emit('ready');
        }
      } else if (event.subtype === 'api_retry') {
        this._stats.retries++;
        this._stats.lastRetryError = (event.error as string | undefined) ?? 'unknown';
      }
      return;
    }

    if (!this._resolve) return; // no active turn

    this._turnEvents.push(event);

    // ── accumulate text ──
    if (event.type === 'assistant') {
      const msg = event.message as { content?: Array<{ type: string; text?: string }>; usage?: Record<string, number> } | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === 'text' && block.text) {
          this._turnText.push(block.text);
          this.emit('chunk', block.text);
        }
      }
      if (msg?.usage) {
        this._stats.tokensIn += (msg.usage.input_tokens ?? 0);
        this._stats.tokensOut += (msg.usage.output_tokens ?? 0);
        this._stats.cachedTokens += (msg.usage.cache_read_input_tokens ?? 0);
      }
    }

    // ── turn complete ──
    if (event.type === 'result') {
      const subtype = event.subtype as string;
      this._stats.costUsd += (event.total_cost_usd as number | undefined) ?? 0;
      this._stats.turns++;
      this._stats.lastActivity = now;
      if (event.session_id) this.sessionId = event.session_id as string;

      const output = (event.result as string | undefined) ?? this._turnText.join('');
      const resolve = this._resolve;
      const reject = this._reject;
      const events = this._turnEvents.slice();
      this._clearTurn();
      this._isBusy = false;

      if (subtype === 'success') {
        resolve!({ output, sessionId: this.sessionId, events });
      } else {
        reject!(new Error(`Claude error (${subtype}): ${output}`));
      }
    }
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async send(
    message: string,
    opts: { timeout?: number; onChunk?: (text: string) => void } = {},
  ): Promise<SendResult> {
    if (!this._isReady) throw new Error('Session not ready');
    if (this._isBusy) throw new Error('Session is busy');
    if (this._isPaused) throw new Error('Session is paused');
    if (!this.proc) throw new Error('No subprocess');

    this._isBusy = true;
    this._turnEvents = [];
    this._turnText = [];

    if (opts.onChunk) {
      const handler = (text: string) => opts.onChunk!(text);
      this.on('chunk', handler);
      this.once('turn-end', () => this.removeListener('chunk', handler));
    }

    return new Promise<SendResult>((resolve, reject) => {
      const ms = opts.timeout ?? TURN_TIMEOUT_MS;
      this._turnTimer = setTimeout(() => {
        const rej = this._reject;
        this._clearTurn();
        this._isBusy = false;
        (rej ?? reject)(new Error(`Turn timed out after ${ms}ms`));
      }, ms);

      this._resolve = resolve;
      this._reject = reject;

      const payload =
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: message }] },
        }) + '\n';

      this.proc!.stdin!.write(payload, (err) => {
        if (err) {
          this._clearTurn();
          this._isBusy = false;
          reject(err);
        }
      });
    });
  }

  // ─── Compact ───────────────────────────────────────────────────────────────

  compact(summary?: string): Promise<SendResult> {
    const text = summary ? `/compact ${summary}` : '/compact';
    return this.send(text, { timeout: COMPACT_TIMEOUT_MS });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  stop(): void {
    if (this._reject) {
      this._reject(new Error('Session stopped'));
      this._clearTurn();
    }
    if (this.proc) {
      try { this.proc.stdin!.end(); } catch {}
      this.proc.kill('SIGTERM');
      const p = this.proc;
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, STOP_SIGKILL_DELAY_MS);
      this.proc = null;
    }
    this._isReady = false;
    this._isBusy = false;
  }

  pause(): void { this._isPaused = true; }
  resume(): void { this._isPaused = false; }

  private _clearTurn(): void {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    this._resolve = null;
    this._reject = null;
    this.emit('turn-end');
  }
}

// ─── CLI args builder ─────────────────────────────────────────────────────────

export function buildArgs(cfg: SessionConfig): string[] {
  const args: string[] = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--replay-user-messages',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', cfg.permissionMode ?? 'bypassPermissions',
  ];

  if (cfg.model) args.push('--model', resolveModelAlias(cfg.model));
  if (cfg.effort && cfg.effort !== 'auto') args.push('--effort', cfg.effort);
  if (cfg.maxTurns) args.push('--max-turns', String(cfg.maxTurns));
  if (cfg.appendSystemPrompt) args.push('--append-system-prompt', cfg.appendSystemPrompt);

  if (cfg.resumeSessionId) {
    args.push('--resume', cfg.resumeSessionId);
    if (cfg.forkSession) args.push('--fork-session');
  }

  if (cfg.allowedTools?.length) {
    args.push('--allowedTools', cfg.allowedTools.join(','));
  }
  if (cfg.disallowedTools?.length) {
    args.push('--disallowedTools', cfg.disallowedTools.join(','));
  }

  const mcps = Array.isArray(cfg.mcpConfig)
    ? cfg.mcpConfig
    : cfg.mcpConfig
      ? [cfg.mcpConfig]
      : [];
  for (const m of mcps) args.push('--mcp-config', m);

  return args;
}

