/**
 * SessionManager — orchestrates multiple PersistentClaudeSession instances
 *
 * Handles: session lifecycle, persistence, model/tool hot-swap,
 * ensemble, ultraplan (overture), ultrareview (finale),
 * project purge, circuit breaker, and orphan PID cleanup.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PersistentClaudeSession } from './session.js';
import { Ensemble } from './ensemble.js';
import { validateRegex } from './validation.js';
import { resolveModelAlias, DEFAULT_SESSION_TTL_MINUTES, DISK_TTL_DAYS, CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_BACKOFF_BASE_MS, CIRCUIT_BREAKER_MAX_BACKOFF_MS, ENSEMBLE_RESULT_TTL_MS, ULTRAPLAN_TIMEOUT_MS, ULTRAPLAN_RESULT_TTL_MS, ULTRAREVIEW_RESULT_TTL_MS, } from './types.js';
const exec = promisify(execFile);
// ─── Paths ────────────────────────────────────────────────────────────────────
const OPENCLAW_DIR = path.join(process.env.HOME ?? '/tmp', '.openclaw');
const SESSIONS_FILE = path.join(OPENCLAW_DIR, 'clawnductor-sessions.json');
const PIDS_FILE = path.join(OPENCLAW_DIR, 'clawnductor-pids.json');
const ENSEMBLES_FILE = path.join(OPENCLAW_DIR, 'clawnductor-ensembles.json');
// ─── CircuitBreaker ───────────────────────────────────────────────────────────
class CircuitBreaker {
    failures = 0;
    openUntil = 0;
    isOpen() {
        if (Date.now() < this.openUntil)
            return true;
        if (this.openUntil && Date.now() >= this.openUntil) {
            // reset after backoff expired
            this.openUntil = 0;
        }
        return false;
    }
    recordSuccess() {
        this.failures = 0;
        this.openUntil = 0;
    }
    recordFailure() {
        this.failures++;
        if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
            const backoff = Math.min(CIRCUIT_BREAKER_BACKOFF_BASE_MS * Math.pow(2, this.failures - CIRCUIT_BREAKER_THRESHOLD), CIRCUIT_BREAKER_MAX_BACKOFF_MS);
            this.openUntil = Date.now() + backoff;
        }
    }
    status() {
        return {
            open: this.isOpen(),
            failures: this.failures,
            retryAfter: this.openUntil ? new Date(this.openUntil).toISOString() : undefined,
        };
    }
}
// ─── SessionManager ───────────────────────────────────────────────────────────
export class SessionManager {
    sessions = new Map();
    persisted = [];
    pids = new Map(); // name → pid
    cleanupTimer = null;
    cb = new CircuitBreaker();
    ensembles = new Map();
    savedEnsembles = {};
    ultraplans = new Map();
    ultrareviews = new Map();
    _reviewPollers = new Set();
    log;
    config;
    constructor(raw = {}, log) {
        this.config = {
            claudeBin: raw.claudeBin ?? process.env.CLAUDE_BIN ?? 'claude',
            defaultModel: raw.defaultModel,
            defaultPermissionMode: raw.defaultPermissionMode ?? 'bypassPermissions',
            maxConcurrentSessions: raw.maxConcurrentSessions ?? 5,
            sessionTtlMinutes: raw.sessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES,
        };
        this.log = log ?? (() => { });
        this._loadPersisted();
        this._loadEnsembles();
        this._cleanupOrphanPids();
        const ttlMs = this.config.sessionTtlMinutes * 60_000;
        this.cleanupTimer = setInterval(() => this._gcIdleSessions(ttlMs), 60_000);
        this.cleanupTimer.unref?.();
    }
    // ─── Start session ─────────────────────────────────────────────────────────
    async startSession(input) {
        if (this.cb.isOpen()) {
            const cbStatus = JSON.stringify(this.cb.status());
            this.log(`[session] circuit breaker open — rejecting new session. ${cbStatus}`);
            throw new Error(`Session circuit breaker open — too many consecutive failures. ${cbStatus}`);
        }
        const name = input.name ?? `session-${Date.now()}`;
        // Stop any existing session with the same name before counting toward the limit
        const existingRec = this.sessions.get(name);
        if (existingRec) {
            if (existingRec.session.isBusy) {
                throw new Error(`Session "${name}" is currently busy — stop it first or use a different name`);
            }
            existingRec.session.stop();
            this.sessions.delete(name);
            this.pids.delete(name);
            this.log(`[session:${name}] stopped (replaced by new session with same name)`);
        }
        if (this.sessions.size >= this.config.maxConcurrentSessions) {
            throw new Error(`Max concurrent sessions (${this.config.maxConcurrentSessions}) reached`);
        }
        // Auto-resume if persisted session exists with this name
        const existing = this.persisted.find((p) => p.name === name);
        const resolvedResumeId = input.resumeSessionId ?? existing?.claudeSessionId;
        const cfg = {
            name,
            cwd: path.resolve(input.cwd ?? process.cwd()),
            model: input.model ?? this.config.defaultModel,
            permissionMode: input.permissionMode ?? this.config.defaultPermissionMode,
            effort: input.effort,
            allowedTools: input.allowedTools,
            disallowedTools: input.disallowedTools,
            maxTurns: input.maxTurns,
            appendSystemPrompt: input.appendSystemPrompt,
            bare: input.bare,
            worktree: input.worktree,
            resumeSessionId: resolvedResumeId,
            forkSession: input.forkSession,
            mcpConfig: input.mcpConfig,
            noSessionPersistence: input.noSessionPersistence,
        };
        const claudeSession = new PersistentClaudeSession(cfg, this.config.claudeBin);
        try {
            await claudeSession.start();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log(`[session:${name}] failed to start — ${msg}`);
            this.cb.recordFailure();
            if (this.cb.isOpen()) {
                this.log(`[session] circuit breaker opened after ${CIRCUIT_BREAKER_THRESHOLD} failures`);
            }
            throw err;
        }
        this.cb.recordSuccess();
        this.log(`[session:${name}] started`);
        const record = {
            session: claudeSession,
            config: cfg,
            created: new Date().toISOString(),
            lastUsed: Date.now(),
        };
        this.sessions.set(name, record);
        if (claudeSession.pid) {
            this.pids.set(name, claudeSession.pid);
            this._savePids();
        }
        if (!cfg.noSessionPersistence) {
            this._persistSession(name, claudeSession);
        }
        return this._toInfo(name, record);
    }
    // ─── Send message ──────────────────────────────────────────────────────────
    async sendMessage(name, message, opts = {}) {
        const rec = this._get(name);
        rec.lastUsed = Date.now();
        let text = message;
        if (opts.plan)
            text = `/plan ${message}`;
        const result = await rec.session.send(text, {
            timeout: opts.timeout,
            onChunk: opts.onChunk,
        });
        if (result.error) {
            this.log(`[session:${name}] send error — ${result.error}`);
        }
        if (!rec.config.noSessionPersistence) {
            this._persistSession(name, rec.session);
        }
        return result;
    }
    // ─── Stop ──────────────────────────────────────────────────────────────────
    async stopSession(name) {
        const rec = this.sessions.get(name);
        if (rec) {
            rec.session.stop();
            this.sessions.delete(name);
            this.pids.delete(name);
            this._savePids();
            this.log(`[session:${name}] stopped`);
        }
    }
    // ─── List ──────────────────────────────────────────────────────────────────
    listSessions() {
        return [...this.sessions.entries()].map(([name, rec]) => this._toInfo(name, rec));
    }
    listPersistedSessions() {
        const cutoff = Date.now() - DISK_TTL_DAYS * 86_400_000;
        return this.persisted.filter((p) => p.lastActivity > cutoff);
    }
    getStatus(name) {
        const rec = this._get(name);
        return { ...this._toInfo(name, rec), stats: rec.session.getStats() };
    }
    async grepSession(name, pattern, limit = 50) {
        const rec = this._get(name);
        const re = new RegExp(validateRegex(pattern), 'i');
        return rec.session
            .getHistory(500)
            .filter((h) => re.test(JSON.stringify(h.event)))
            .slice(-limit)
            .map((h) => ({ time: h.time, type: h.type, content: JSON.stringify(h.event).slice(0, 500) }));
    }
    async compactSession(name, summary) {
        const rec = this._get(name);
        await rec.session.compact(summary);
    }
    // ─── Model switch ──────────────────────────────────────────────────────────
    async switchModel(name, model) {
        const rec = this._get(name);
        if (rec.session.isBusy)
            throw new Error('Session is busy');
        const resumeId = rec.session.sessionId;
        // Remove from map temporarily so maxConcurrent check passes for the replacement
        this.sessions.delete(name);
        this.pids.delete(name);
        const newCfg = { ...rec.config, model, resumeSessionId: resumeId };
        try {
            const info = await this.startSession(newCfg);
            rec.session.stop();
            return info;
        }
        catch (err) {
            // Rollback: restore old session
            this.sessions.set(name, rec);
            if (rec.session.pid)
                this.pids.set(name, rec.session.pid);
            throw err;
        }
    }
    // ─── Tool update ───────────────────────────────────────────────────────────
    async updateTools(name, opts) {
        const rec = this._get(name);
        if (rec.session.isBusy)
            throw new Error('Session is busy');
        let allowed = opts.merge ? [...(rec.config.allowedTools ?? [])] : (opts.allowedTools ?? rec.config.allowedTools ?? []);
        let disallowed = opts.merge ? [...(rec.config.disallowedTools ?? [])] : (opts.disallowedTools ?? rec.config.disallowedTools ?? []);
        if (opts.merge) {
            if (opts.allowedTools)
                allowed = [...new Set([...allowed, ...opts.allowedTools])];
            if (opts.disallowedTools)
                disallowed = [...new Set([...disallowed, ...opts.disallowedTools])];
        }
        if (opts.removeTools?.length) {
            const rm = new Set(opts.removeTools);
            allowed = allowed.filter((t) => !rm.has(t));
            disallowed = disallowed.filter((t) => !rm.has(t));
        }
        const resumeId = rec.session.sessionId;
        this.sessions.delete(name);
        this.pids.delete(name);
        const newCfg = { ...rec.config, allowedTools: allowed, disallowedTools: disallowed, resumeSessionId: resumeId };
        try {
            const info = await this.startSession(newCfg);
            rec.session.stop();
            return info;
        }
        catch (err) {
            this.sessions.set(name, rec);
            if (rec.session.pid)
                this.pids.set(name, rec.session.pid);
            throw err;
        }
    }
    // ─── Agents list ───────────────────────────────────────────────────────────
    listAgents(cwd) {
        const dir = path.join(cwd ?? process.cwd(), '.claude', 'agents');
        if (!fs.existsSync(dir))
            return [];
        return fs.readdirSync(dir)
            .filter((f) => f.endsWith('.md'))
            .map((f) => {
            const file = path.join(dir, f);
            const content = fs.readFileSync(file, 'utf8');
            const desc = content.match(/^description:\s*(.+)$/m)?.[1] ?? '';
            return { name: f.replace(/\.md$/, ''), file, description: desc };
        });
    }
    // ─── Health ────────────────────────────────────────────────────────────────
    health() {
        const details = [...this.sessions.entries()].map(([name, rec]) => {
            const stats = rec.session.getStats();
            return {
                name,
                cwd: rec.config.cwd,
                model: rec.config.model,
                isReady: stats.isReady,
                busy: stats.busy,
                contextPercent: stats.contextPercent,
                costUsd: stats.costUsd,
                turns: stats.turns,
                lastActivity: stats.lastActivity,
            };
        });
        return {
            ok: true,
            sessions: this.sessions.size,
            sessionNames: [...this.sessions.keys()],
            uptime: process.uptime(),
            circuitBreaker: this.cb.status(),
            details,
        };
    }
    // ─── Ensemble ─────────────────────────────────────────────────────────────────
    ensembleStart(task, config) {
        const id = randomUUID();
        const ensembleSession = {
            id,
            task,
            config,
            responses: [],
            status: 'running',
            round: 0,
            startTime: new Date().toISOString(),
        };
        const ensemble = new Ensemble(ensembleSession, this.config.claudeBin, this.log);
        this.ensembles.set(id, ensemble);
        this._saveEnsembleState(ensembleSession);
        // Run in background; save final state and auto-cleanup after TTL
        ensemble.run().catch(() => { }).finally(() => {
            this._saveEnsembleState(ensemble.session);
            setTimeout(() => this.ensembles.delete(id), ENSEMBLE_RESULT_TTL_MS);
        });
        return ensembleSession;
    }
    ensembleStatus(id) {
        return this.ensembles.get(id)?.session ?? this.savedEnsembles[id];
    }
    ensembleAbort(id) {
        const e = this.ensembles.get(id);
        if (e) {
            e.abort();
            this._saveEnsembleState(e.session);
        }
        else {
            this.log(`[ensemble:${id}] abort requested but ensemble not in memory`);
        }
    }
    ensembleInject(id, message) {
        const e = this.ensembles.get(id);
        if (!e)
            throw new Error(`Ensemble ${id} not found`);
        e.inject(message);
    }
    ensembleReview(id) {
        const e = this.ensembles.get(id);
        if (!e)
            throw new Error(`Ensemble ${id} not found`);
        return e.review();
    }
    ensembleAccept(id) {
        const e = this.ensembles.get(id);
        if (!e)
            throw new Error(`Ensemble ${id} not found`);
        return e.accept().then((result) => {
            this._saveEnsembleState(e.session);
            return result;
        });
    }
    ensembleReject(id, feedback) {
        const e = this.ensembles.get(id);
        if (!e)
            throw new Error(`Ensemble ${id} not found`);
        return e.reject(feedback).then((result) => {
            this._saveEnsembleState(e.session);
            return result;
        });
    }
    // ─── Ultraplan (overture) ──────────────────────────────────────────────────
    ultraplanStart(task, opts = {}) {
        const id = randomUUID();
        const sessionName = `overture-${id.slice(0, 8)}`;
        const result = {
            id,
            status: 'running',
            sessionName,
            startTime: new Date().toISOString(),
        };
        this.log(`[overture:${id.slice(0, 8)}] starting`);
        this.ultraplans.set(id, result);
        this._runUltraplan(id, task, sessionName, opts).catch(() => { });
        setTimeout(() => this.ultraplans.delete(id), ULTRAPLAN_RESULT_TTL_MS);
        return result;
    }
    async _runUltraplan(id, task, sessionName, opts) {
        const result = this.ultraplans.get(id);
        try {
            const session = new PersistentClaudeSession({
                name: sessionName,
                cwd: path.resolve(opts.cwd ?? process.cwd()),
                model: opts.model ?? 'opus',
                permissionMode: 'bypassPermissions',
                appendSystemPrompt: ULTRAPLAN_SYSTEM_PROMPT,
                bare: true,
            }, this.config.claudeBin);
            await session.start();
            const sendResult = await session.send(task, {
                timeout: opts.timeout ?? ULTRAPLAN_TIMEOUT_MS,
            });
            session.stop();
            result.status = 'completed';
            result.plan = sendResult.output;
            result.endTime = new Date().toISOString();
            this.log(`[overture:${id.slice(0, 8)}] completed`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.status = msg.includes('timed out') ? 'timeout' : 'error';
            result.error = msg;
            result.endTime = new Date().toISOString();
            this.log(`[overture:${id.slice(0, 8)}] ${result.status} — ${msg}`);
        }
    }
    ultraplanStatus(id) {
        return this.ultraplans.get(id);
    }
    // ─── Ultrareview (finale) ──────────────────────────────────────────────────
    ultrareviewStart(cwd, opts = {}) {
        const id = randomUUID();
        const agentCount = Math.min(20, Math.max(1, opts.agentCount ?? 5));
        const maxDurationMinutes = Math.min(25, Math.max(5, opts.maxDurationMinutes ?? 10));
        const focus = opts.focus ?? 'Find all bugs, security vulnerabilities, and code quality issues';
        const selectedReviewers = REVIEWER_FLEET.slice(0, agentCount).map((r) => ({
            name: r.name,
            emoji: r.emoji,
            persona: `${r.focus}. ${focus}.`,
            model: opts.model,
            permissionMode: 'bypassPermissions',
        }));
        const ensembleSession = this.ensembleStart(`Conduct a parallel code review of the codebase at ${cwd}. ${focus}. Each reviewer writes their findings to reviews/<reviewer>-findings.md and votes [CONSENSUS: YES] when done.`, {
            agents: selectedReviewers,
            maxRounds: 2,
            projectDir: cwd,
            agentTimeoutMs: maxDurationMinutes * 60_000,
            maxTurnsPerAgent: 20,
            defaultPermissionMode: 'bypassPermissions',
        });
        const reviewResult = {
            id,
            status: 'running',
            ensembleId: ensembleSession.id,
            agentCount,
            startTime: new Date().toISOString(),
        };
        this.ultrareviews.set(id, reviewResult);
        this.log(`[finale:${id.slice(0, 8)}] started ${agentCount} reviewers`);
        // Poll ensemble for completion; tracked so shutdown() can clear it
        const poller = setInterval(() => {
            const es = this.ensembleStatus(ensembleSession.id);
            if (!es || es.status === 'running')
                return;
            clearInterval(poller);
            this._reviewPollers.delete(poller);
            reviewResult.endTime = new Date().toISOString();
            if (es.status === 'consensus' || es.status === 'max_rounds') {
                reviewResult.status = 'completed';
                reviewResult.findings = this._synthesizeFindings(cwd, es);
                this.log(`[finale:${id.slice(0, 8)}] completed — status: ${es.status}`);
            }
            else {
                reviewResult.status = 'error';
                this.log(`[finale:${id.slice(0, 8)}] ended with ensemble status: ${es.status}`);
            }
            setTimeout(() => this.ultrareviews.delete(id), ULTRAREVIEW_RESULT_TTL_MS);
        }, 10_000);
        this._reviewPollers.add(poller);
        return reviewResult;
    }
    ultrareviewStatus(id) {
        return this.ultrareviews.get(id);
    }
    _synthesizeFindings(cwd, ensemble) {
        const reviewsDir = `${path.resolve(cwd)}/reviews`;
        const parts = ['# Finale Review Findings\n'];
        // Try to read individual reviewer files
        try {
            if (fs.existsSync(reviewsDir)) {
                for (const f of fs.readdirSync(reviewsDir)) {
                    if (f.endsWith('.md')) {
                        parts.push(`## ${f}\n`);
                        parts.push(fs.readFileSync(`${reviewsDir}/${f}`, 'utf8'));
                        parts.push('');
                    }
                }
            }
        }
        catch { }
        // Fall back to agent response text
        if (parts.length <= 1) {
            const last = Math.max(...ensemble.responses.map((r) => r.round));
            for (const r of ensemble.responses.filter((x) => x.round === last)) {
                parts.push(`## ${r.agent}\n`, r.content, '');
            }
        }
        return parts.join('\n');
    }
    // ─── Project purge ─────────────────────────────────────────────────────────
    async purgeProject(opts) {
        const dryRun = opts.dryRun ?? true;
        const args = ['project', 'purge', '--yes'];
        if (opts.all) {
            args.push('--all');
        }
        else if (opts.path) {
            args.push(path.resolve(opts.path));
        }
        if (dryRun)
            args.push('--dry-run');
        try {
            const { stdout, stderr } = await exec(this.config.claudeBin, args);
            return { stdout: stdout ?? '', stderr: stderr ?? '', dryRun };
        }
        catch (err) {
            const e = err;
            return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err), dryRun };
        }
    }
    // ─── Shutdown ──────────────────────────────────────────────────────────────
    async shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        for (const poller of this._reviewPollers)
            clearInterval(poller);
        this._reviewPollers.clear();
        for (const [name, rec] of this.sessions) {
            rec.session.stop();
            this.sessions.delete(name);
            this.log(`[session:${name}] stopped on shutdown`);
        }
        // Ensembles are intentionally NOT aborted — they run to completion as detached
        // background work. The finally block in ensembleStart() saves final state to disk.
        for (const ensemble of this.ensembles.values()) {
            this.log(`[ensemble:${ensemble.id}] detached on shutdown — will run to completion`);
            this._saveEnsembleState(ensemble.session);
        }
        this.pids.clear();
        this._savePids();
    }
    // ─── Persistence ───────────────────────────────────────────────────────────
    _persistSession(name, session) {
        const rec = this.sessions.get(name);
        if (!rec || !session.sessionId)
            return;
        const entry = {
            name,
            claudeSessionId: session.sessionId,
            cwd: rec.config.cwd,
            model: rec.config.model,
            permissionMode: rec.config.permissionMode ?? 'bypassPermissions',
            created: rec.created,
            lastActivity: Date.now(),
        };
        const idx = this.persisted.findIndex((p) => p.name === name);
        if (idx >= 0)
            this.persisted[idx] = entry;
        else
            this.persisted.push(entry);
        try {
            fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this.persisted, null, 2));
        }
        catch { }
    }
    _loadPersisted() {
        try {
            if (fs.existsSync(SESSIONS_FILE)) {
                this.persisted = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            }
        }
        catch {
            this.persisted = [];
        }
    }
    _saveEnsembleState(session) {
        this.savedEnsembles[session.id] = session;
        try {
            fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
            fs.writeFileSync(ENSEMBLES_FILE, JSON.stringify(this.savedEnsembles, null, 2));
        }
        catch { }
    }
    _loadEnsembles() {
        try {
            if (!fs.existsSync(ENSEMBLES_FILE))
                return;
            const data = JSON.parse(fs.readFileSync(ENSEMBLES_FILE, 'utf8'));
            const cutoff = Date.now() - 7 * 86_400_000; // prune entries older than 7 days
            for (const [id, session] of Object.entries(data)) {
                if (session.startTime && new Date(session.startTime).getTime() < cutoff)
                    continue;
                if (session.status === 'running') {
                    session.status = 'abandoned';
                    session.error = 'Manager restarted while ensemble was running';
                    session.endTime = new Date().toISOString();
                    this.log(`[ensemble:${id}] marked abandoned — was running when manager last stopped`);
                }
                this.savedEnsembles[id] = session;
            }
        }
        catch { }
    }
    _savePids() {
        try {
            fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
            fs.writeFileSync(PIDS_FILE, JSON.stringify(Object.fromEntries(this.pids)));
        }
        catch { }
    }
    _cleanupOrphanPids() {
        try {
            if (!fs.existsSync(PIDS_FILE))
                return;
            const saved = JSON.parse(fs.readFileSync(PIDS_FILE, 'utf8'));
            for (const [, pid] of Object.entries(saved)) {
                try {
                    process.kill(pid, 0); // check alive
                    // Verify it's actually a claude process before killing — guards against PID recycling
                    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
                    if (!cmdline.includes('claude'))
                        continue;
                    process.kill(pid, 'SIGTERM');
                    setTimeout(() => {
                        try {
                            const cmdline2 = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
                            if (cmdline2.includes('claude'))
                                process.kill(pid, 'SIGKILL');
                        }
                        catch { }
                    }, 3000);
                }
                catch {
                    // Not running or no /proc entry — ignore
                }
            }
            fs.unlinkSync(PIDS_FILE);
        }
        catch { }
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    _get(name) {
        const rec = this.sessions.get(name);
        if (!rec)
            throw new Error(`Session "${name}" not found`);
        return rec;
    }
    _toInfo(name, rec) {
        const stats = rec.session.getStats();
        return {
            name,
            claudeSessionId: rec.session.sessionId,
            cwd: rec.config.cwd,
            model: rec.config.model ? resolveModelAlias(rec.config.model) : undefined,
            permissionMode: rec.config.permissionMode ?? 'bypassPermissions',
            created: rec.created,
            stats,
            paused: rec.session.isPaused,
            busy: rec.session.isBusy,
        };
    }
    _gcIdleSessions(ttlMs) {
        const cutoff = Date.now() - ttlMs;
        for (const [name, rec] of this.sessions) {
            if (rec.lastUsed < cutoff && !rec.session.isBusy) {
                rec.session.stop();
                this.sessions.delete(name);
                this.pids.delete(name);
                this.log(`[session:${name}] evicted (idle TTL)`);
            }
        }
        this._savePids();
    }
}
// ─── Ultraplan system prompt ──────────────────────────────────────────────────
const ULTRAPLAN_SYSTEM_PROMPT = `You are a deep technical planner. Your only job is to produce a thorough implementation plan.

Rules:
- Explore the codebase exhaustively before writing the plan
- Check existing files, dependencies, test patterns, and architectural conventions
- Output ONLY the plan — no code changes, no implementations
- Use markdown with ## sections and - [ ] checkbox task lists
- Include: overview, architecture decisions, task breakdown, testing strategy, edge cases, risks
- Be specific enough that a separate implementation agent can execute each task without questions`;
// ─── Reviewer fleet definitions ───────────────────────────────────────────────
const REVIEWER_FLEET = [
    { name: 'SecurityReviewer', emoji: '🔒', focus: 'Injection attacks, auth flaws, data exposure, OWASP top 10, secrets in code' },
    { name: 'LogicReviewer', emoji: '🧩', focus: 'Off-by-one errors, race conditions, null/undefined handling, edge case logic' },
    { name: 'PerformanceReviewer', emoji: '⚡', focus: 'O(n²) loops, memory leaks, missing caching, N+1 queries, blocking I/O' },
    { name: 'APIReviewer', emoji: '🔌', focus: 'Inconsistent interfaces, missing validation, error response gaps, breaking changes' },
    { name: 'TestReviewer', emoji: '🧪', focus: 'Untested code paths, missing edge case tests, flaky test patterns, assert quality' },
    { name: 'TypeReviewer', emoji: '📐', focus: 'Unsafe type casts, any/unknown misuse, missing null checks, type widening bugs' },
    { name: 'ConcurrencyReviewer', emoji: '🔄', focus: 'Race conditions, deadlocks, unhandled async errors, shared mutable state' },
    { name: 'ErrorReviewer', emoji: '💥', focus: 'Swallowed errors, missing try/catch, silent failures, crash paths' },
    { name: 'DependencyReviewer', emoji: '📦', focus: 'Outdated packages, known CVEs, unnecessary dependencies, license issues' },
    { name: 'ReadabilityReviewer', emoji: '📖', focus: 'Unclear naming, overly complex functions, dead code, misleading comments' },
    { name: 'DataReviewer', emoji: '🗄️', focus: 'Input validation gaps, schema mismatches, encoding bugs, data truncation' },
    { name: 'ConfigReviewer', emoji: '⚙️', focus: 'Hardcoded values, missing env vars, insecure defaults, config injection' },
    { name: 'ScalabilityReviewer', emoji: '📈', focus: 'Single points of failure, unbounded data growth, missing pagination' },
    { name: 'DocReviewer', emoji: '📝', focus: 'Outdated documentation, missing API docs, misleading examples' },
    { name: 'NetworkReviewer', emoji: '🌐', focus: 'Missing timeouts, no retry logic, connection leaks, unvalidated URLs' },
    { name: 'AuthReviewer', emoji: '🗝️', focus: 'Token handling, CSRF, session fixation, privilege escalation, RBAC gaps' },
    { name: 'CryptoReviewer', emoji: '🔐', focus: 'Weak algorithms, hardcoded keys, improper RNG, padding oracle risks' },
    { name: 'MemoryReviewer', emoji: '🧠', focus: 'Memory leaks, circular references, buffer overflows, stream backpressure' },
    { name: 'A11yReviewer', emoji: '♿', focus: 'Missing ARIA labels, keyboard navigation gaps, color contrast, screen reader support' },
    { name: 'I18nReviewer', emoji: '🌍', focus: 'Hardcoded strings, locale handling bugs, RTL layout, date/number formatting' },
];
//# sourceMappingURL=session-manager.js.map