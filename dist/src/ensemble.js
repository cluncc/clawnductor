/**
 * Ensemble — multi-agent ensemble with git worktree isolation
 *
 * Round 1: all agents write plan.md in parallel (no code allowed)
 * Round 2+: agents claim tasks, implement, merge to main, cross-review
 * Done when all agents vote [CONSENSUS: YES] or max rounds reached
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentClaudeSession } from './session.js';
import { validateAgentName } from './validation.js';
import { INTER_ROUND_DELAY_MS, GIT_CMD_TIMEOUT_MS, WORKTREE_DIR, DEFAULT_AGENT_TIMEOUT_MS, DEFAULT_MAX_ROUNDS, DEFAULT_MAX_TURNS_PER_AGENT, } from './types.js';
// ─── Consensus ────────────────────────────────────────────────────────────────
export function parseConsensus(text) {
    const m = text.match(/\[CONSENSUS:\s*(YES|NO)\]/i);
    if (!m)
        return null;
    return m[1].toUpperCase() === 'YES';
}
// ─── Git helpers ──────────────────────────────────────────────────────────────
function git(args, cwd, timeoutMs = GIT_CMD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd, stdio: 'pipe' });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`git ${args[0]} timed out`));
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0)
                reject(new Error(`git ${args.join(' ')} failed: ${err.trim()}`));
            else
                resolve({ stdout: out, stderr: err });
        });
        child.on('error', reject);
    });
}
// ─── System prompt loader ─────────────────────────────────────────────────────
function loadSystemPrompt() {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const promptPath = path.join(dir, '../../configs/council-system-prompt.md');
    try {
        return fs.readFileSync(promptPath, 'utf8');
    }
    catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}
// ─── Ensemble ─────────────────────────────────────────────────────────────────
export class Ensemble extends EventEmitter {
    session;
    _agentSessions = new Map();
    _aborted = false;
    claudeBin;
    _injected = [];
    log;
    constructor(session, claudeBin, log) {
        super();
        this.session = session;
        this.claudeBin = claudeBin;
        this.log = log ?? (() => { });
    }
    get id() { return this.session.id; }
    abort() {
        this._aborted = true;
        for (const s of this._agentSessions.values())
            s.stop();
        this._agentSessions.clear();
        this.log(`[ensemble:${this.id}] aborted`);
    }
    inject(message) {
        this._injected.push(message);
    }
    // ─── Run ───────────────────────────────────────────────────────────────────
    async run() {
        const { config, task } = this.session;
        const projectDir = path.resolve(config.projectDir);
        const maxRounds = config.maxRounds ?? DEFAULT_MAX_ROUNDS;
        this.log(`[ensemble:${this.id}] starting — task: ${task.slice(0, 80)}`);
        this._flushLog();
        this.session.status = 'running';
        try {
            // Ensure project dir is a git repo with at least one commit (required for worktrees)
            try {
                await git(['rev-parse', '--git-dir'], projectDir);
                // Repo exists — ensure HEAD is valid (worktree add fails on commitless repos)
                try {
                    await git(['rev-parse', 'HEAD'], projectDir);
                }
                catch {
                    await git([
                        '-c', 'user.email=ensemble@local', '-c', 'user.name=Ensemble',
                        'commit', '--allow-empty', '-m', 'init: ensemble workspace',
                    ], projectDir);
                }
            }
            catch {
                await git(['init'], projectDir);
                await git([
                    '-c', 'user.email=ensemble@local', '-c', 'user.name=Ensemble',
                    'commit', '--allow-empty', '-m', 'init: ensemble workspace',
                ], projectDir);
            }
            // Set up worktrees and branches for each agent
            await this._setupWorktrees(projectDir, config.agents);
            for (let round = 1; round <= maxRounds; round++) {
                if (this._aborted)
                    break;
                this.session.round = round;
                this.log(`[ensemble:${this.id}] round ${round}/${maxRounds} starting`);
                const injected = this._injected.splice(0);
                const planContent = this._readPlan(projectDir);
                const gitLog = await this._getGitLog(projectDir);
                const responses = await this._runRound(round, task, config, projectDir, planContent, gitLog, injected);
                // Check consensus
                const votes = responses.map((r) => r.consensus);
                const allYes = config.agents.length > 0 && votes.length === config.agents.length && votes.every(Boolean);
                const voteStr = responses.map((r) => `${r.agent}:${r.consensus ? 'YES' : 'NO'}`).join(' ');
                this.log(`[ensemble:${this.id}] round ${round} votes — ${voteStr}`);
                this._flushLog();
                if (allYes) {
                    this.session.status = 'consensus';
                    this.session.endTime = new Date().toISOString();
                    this.log(`[ensemble:${this.id}] consensus reached after ${round} round(s)`);
                    break;
                }
                if (round < maxRounds) {
                    await new Promise((r) => setTimeout(r, INTER_ROUND_DELAY_MS));
                }
            }
            if (this.session.status === 'running') {
                this.session.status = 'max_rounds';
                this.session.endTime = new Date().toISOString();
                this.log(`[ensemble:${this.id}] max rounds (${maxRounds}) reached without consensus`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.session.status = 'error';
            this.session.error = msg;
            this.session.endTime = new Date().toISOString();
            this.log(`[ensemble:${this.id}] error — ${msg}`);
        }
        finally {
            for (const s of this._agentSessions.values())
                s.stop();
            this._agentSessions.clear();
            this._flushLog();
        }
    }
    // ─── Round execution ───────────────────────────────────────────────────────
    async _runRound(round, task, config, projectDir, planContent, gitLog, injected) {
        const agentTimeoutMs = config.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
        const maxTurns = config.maxTurnsPerAgent ?? DEFAULT_MAX_TURNS_PER_AGENT;
        const responses = await Promise.all(config.agents.map(async (agent) => {
            let response;
            try {
                response = await this._runAgent(agent, round, task, config, projectDir, planContent, gitLog, injected, agentTimeoutMs, maxTurns);
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                this.log(`[ensemble:${this.id}] agent ${agent.name} round ${round} failed — ${errMsg}`);
                response = {
                    agent: agent.name,
                    round,
                    content: `[ERROR] ${errMsg}`,
                    consensus: false,
                    timestamp: new Date().toISOString(),
                };
            }
            this.session.responses.push(response);
            this._flushLog();
            return response;
        }));
        return responses;
    }
    async _runAgent(agent, round, task, config, projectDir, planContent, gitLog, injected, timeoutMs, maxTurns) {
        const safeName = validateAgentName(agent.name);
        const worktreeDir = path.join(projectDir, WORKTREE_DIR, safeName);
        const branchName = `ensemble/${safeName}`;
        const permissionMode = agent.permissionMode ?? config.defaultPermissionMode ?? 'bypassPermissions';
        const otherBranches = config.agents
            .filter((a) => a.name !== agent.name)
            .map((a) => `ensemble/${a.name}`)
            .join(', ');
        // Load and personalise system prompt
        const rawPrompt = loadSystemPrompt();
        const systemPrompt = rawPrompt
            .replace(/\{\{emoji\}\}/g, agent.emoji)
            .replace(/\{\{name\}\}/g, agent.name)
            .replace(/\{\{persona\}\}/g, agent.persona)
            .replace(/\{\{workDir\}\}/g, worktreeDir)
            .replace(/\{\{otherBranches\}\}/g, otherBranches);
        // Build round prompt
        const prompt = buildRoundPrompt(round, task, planContent, gitLog, injected, agent, branchName);
        // Get or create the agent's session
        let session = this._agentSessions.get(agent.name);
        if (!session || !session.isReady) {
            if (session)
                session.stop(); // clean up crashed/stale session before replacing
            this.log(`[ensemble:${this.id}] starting agent session ${agent.name} round ${round}`);
            session = new PersistentClaudeSession({
                name: `ensemble-${this.id}-${agent.name}`,
                cwd: worktreeDir,
                model: agent.model ?? config.agents[0].model,
                permissionMode,
                maxTurns,
                appendSystemPrompt: systemPrompt,
                bare: true,
            }, this.claudeBin);
            await session.start();
            this._agentSessions.set(agent.name, session);
        }
        const result = await session.send(prompt, { timeout: timeoutMs });
        const consensus = parseConsensus(result.output) ?? false;
        return {
            agent: agent.name,
            round,
            content: result.output,
            consensus,
            timestamp: new Date().toISOString(),
        };
    }
    // ─── Worktree management ───────────────────────────────────────────────────
    async _setupWorktrees(projectDir, agents) {
        // Prune stale entries before checking — removes .git/worktrees/<name> for directories
        // that no longer exist, preventing false "already exists" errors on re-runs.
        try {
            await git(['worktree', 'prune'], projectDir);
        }
        catch { }
        // Fetch worktree list once; parsing it per-agent would be O(n²) git invocations
        const { stdout: worktreeOut } = await git(['worktree', 'list', '--porcelain'], projectDir);
        const existingWorktrees = new Set(worktreeOut.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length)));
        for (const agent of agents) {
            const safeName = validateAgentName(agent.name);
            const branchName = `ensemble/${safeName}`;
            const worktreePath = path.join(projectDir, WORKTREE_DIR, safeName);
            if (existingWorktrees.has(worktreePath))
                continue;
            // Create branch if it doesn't exist
            try {
                await git(['branch', branchName], projectDir);
            }
            catch {
                // branch already exists, that's fine
            }
            // Remove stale directory: git doesn't track it (not in worktree list) but
            // it exists on disk. git worktree add would fail with "already exists".
            if (fs.existsSync(worktreePath)) {
                fs.rmSync(worktreePath, { recursive: true, force: true });
            }
            fs.mkdirSync(path.join(projectDir, WORKTREE_DIR), { recursive: true });
            await git(['worktree', 'add', worktreePath, branchName], projectDir, 60_000);
        }
    }
    // ─── Review / Accept / Reject ──────────────────────────────────────────────
    async review() {
        const { config, responses, round, status } = this.session;
        const projectDir = path.resolve(config.projectDir);
        // Changed files since ensemble started
        const changedFiles = [];
        try {
            const { stdout } = await git(['diff', '--numstat', 'HEAD~1', 'HEAD'], projectDir);
            for (const line of stdout.trim().split('\n').filter(Boolean)) {
                const [ins, del, file] = line.split('\t');
                changedFiles.push({ file, insertions: parseInt(ins) || 0, deletions: parseInt(del) || 0 });
            }
        }
        catch { }
        // List branches
        let branches = [];
        try {
            const { stdout } = await git(['branch', '--list', 'ensemble/*'], projectDir);
            branches = stdout.trim().split('\n').map((b) => b.trim().replace(/^\*\s*/, '')).filter(Boolean);
        }
        catch { }
        // List worktrees
        let worktrees = [];
        try {
            const worktreeBase = path.join(projectDir, WORKTREE_DIR);
            if (fs.existsSync(worktreeBase)) {
                worktrees = fs.readdirSync(worktreeBase).map((d) => path.join(worktreeBase, d));
            }
        }
        catch { }
        // Plan content
        const planPath = path.join(projectDir, 'plan.md');
        const planExists = fs.existsSync(planPath);
        const planContent = planExists ? fs.readFileSync(planPath, 'utf8') : undefined;
        // Agent summaries from last round's responses
        const lastRoundResponses = responses.filter((r) => r.round === round);
        const agentSummaries = lastRoundResponses.map((r) => ({
            agent: r.agent,
            consensus: r.consensus,
            preview: r.content.slice(0, 500),
        }));
        return {
            ensembleId: this.id,
            projectDir,
            status,
            rounds: round,
            planExists,
            planContent,
            changedFiles,
            branches,
            worktrees,
            agentSummaries,
        };
    }
    async accept() {
        const projectDir = path.resolve(this.session.config.projectDir);
        // Remove worktrees
        const removedWorktrees = [];
        const worktreeBase = path.join(projectDir, WORKTREE_DIR);
        try {
            for (const name of fs.readdirSync(worktreeBase)) {
                const wt = path.join(worktreeBase, name);
                try {
                    await git(['worktree', 'remove', '--force', wt], projectDir, 60_000);
                    removedWorktrees.push(wt);
                }
                catch { }
            }
            fs.rmSync(worktreeBase, { recursive: true, force: true });
        }
        catch { }
        // Delete ensemble branches
        const deletedBranches = [];
        try {
            const { stdout } = await git(['branch', '--list', 'ensemble/*'], projectDir);
            for (const b of stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean)) {
                const branch = b.replace(/^\*\s*/, '');
                try {
                    await git(['branch', '-D', branch], projectDir);
                    deletedBranches.push(branch);
                }
                catch { }
            }
        }
        catch { }
        // Delete plan.md and reviews/
        const planPath = path.join(projectDir, 'plan.md');
        let planDeleted = false;
        if (fs.existsSync(planPath)) {
            fs.unlinkSync(planPath);
            planDeleted = true;
        }
        const reviewsPath = path.join(projectDir, 'reviews');
        if (fs.existsSync(reviewsPath)) {
            fs.rmSync(reviewsPath, { recursive: true, force: true });
        }
        this.session.status = 'accepted';
        this.log(`[ensemble:${this.id}] accepted — removed ${deletedBranches.length} branches, ${removedWorktrees.length} worktrees`);
        return {
            ensembleId: this.id,
            branchesDeleted: deletedBranches,
            worktreesRemoved: removedWorktrees,
            planDeleted,
        };
    }
    async reject(feedback) {
        const projectDir = path.resolve(this.session.config.projectDir);
        const planPath = path.join(projectDir, 'plan.md');
        const content = [
            '# Plan (Rejected — Needs Rework)',
            '',
            `> Feedback: ${feedback}`,
            '',
            '## Uncompleted Tasks',
            '',
            'The ensemble must address the feedback above and re-complete all tasks.',
            '',
        ].join('\n');
        fs.writeFileSync(planPath, content, 'utf8');
        try {
            await git(['add', 'plan.md'], projectDir);
            await git(['commit', '-m', `reject: ensemble ${this.id} — feedback recorded`], projectDir);
        }
        catch { }
        this.session.status = 'rejected';
        this.log(`[ensemble:${this.id}] rejected — feedback recorded`);
        return { ensembleId: this.id, planRewritten: true, feedback };
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    _readPlan(projectDir) {
        const p = path.join(projectDir, 'plan.md');
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    }
    async _getGitLog(projectDir) {
        try {
            const { stdout } = await git(['log', '--oneline', '-15'], projectDir);
            return stdout.trim();
        }
        catch {
            return '(no git history)';
        }
    }
    _logPath() {
        const logDir = path.join(process.env.HOME ?? '/tmp', '.openclaw', 'ensemble-logs');
        fs.mkdirSync(logDir, { recursive: true });
        return path.join(logDir, `ensemble-${this.id}.json`);
    }
    _flushLog() {
        try {
            fs.writeFileSync(this._logPath(), JSON.stringify(this.session, null, 2), 'utf8');
        }
        catch (err) {
            this.log(`[ensemble:${this.id}] log write failed — ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
// ─── Round prompt builder ─────────────────────────────────────────────────────
export function buildRoundPrompt(round, task, plan, gitLog, injected, agent, branchName) {
    const parts = [];
    parts.push(`# Ensemble Round ${round}`);
    parts.push('');
    parts.push(`**Task:** ${task}`);
    parts.push(`**Your branch:** \`${branchName}\``);
    parts.push('');
    if (round === 1) {
        parts.push('## Round 1 — Scoring (Planning)', '', 'Write `plan.md` in the project root. Define all tasks as `- [ ] description` checkboxes.', 'Assign tasks, estimate complexity, describe acceptance criteria.', '**Do NOT write any business code this round.** Plan only.', '', 'After writing plan.md, commit it and merge to main.', '');
    }
    else {
        if (plan) {
            parts.push('## Current plan.md', '', '```markdown', plan, '```', '');
        }
        parts.push('## Round Instructions', '', '1. `git pull origin main` — sync with other agents', '2. Find an unclaimed `- [ ]` task in plan.md', '3. Claim it (change to `- [x] task (your name)`) and commit plan.md', '4. Implement the task, write/run tests', '5. Commit your work and merge to main', '6. Review other agents\' recent commits in the git log', '7. Vote [CONSENSUS: YES] if ALL tasks are done and passing, [CONSENSUS: NO] otherwise', '');
    }
    if (gitLog) {
        parts.push('## Recent git log (main)', '', '```', gitLog, '```', '');
    }
    if (injected.length > 0) {
        parts.push('## Director\'s Cue (from user)', '');
        for (const msg of injected)
            parts.push(`> ${msg}`, '');
    }
    parts.push('---', '', `End your response with exactly one of: \`[CONSENSUS: YES]\` or \`[CONSENSUS: NO]\``);
    return parts.join('\n');
}
// ─── Fallback system prompt ───────────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `# Clawnductor Ensemble Charter

You are **{{emoji}} {{name}}**, part of a multi-agent coding ensemble.

**Persona:** {{persona}}
**Working directory:** {{workDir}}
**Other agents' branches:** {{otherBranches}}

## Rules
- §0 Never fabricate output — use tools to verify everything
- §1 Round 1 = plan.md only, no business code
- §2 Claim tasks before working on them (edit plan.md, commit)
- §3 Git state is truth — check it each round
- §4 Merge to main locally, never push
- §5 Cross-review other agents' work before voting
- §6 Auto-resolve all merge conflicts, never block
- §7 Act, don't ask — no permission-seeking
- §8 Minimum necessary tool calls

End every response with [CONSENSUS: YES] or [CONSENSUS: NO].
`;
//# sourceMappingURL=ensemble.js.map