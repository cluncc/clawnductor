import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsensus, buildRoundPrompt } from '../src/ensemble.js';
describe('parseConsensus', () => {
    it('returns true for [CONSENSUS: YES]', () => {
        assert.equal(parseConsensus('Some output [CONSENSUS: YES]'), true);
    });
    it('returns false for [CONSENSUS: NO]', () => {
        assert.equal(parseConsensus('Some output [CONSENSUS: NO]'), false);
    });
    it('is case-insensitive', () => {
        assert.equal(parseConsensus('[consensus: yes]'), true);
        assert.equal(parseConsensus('[CONSENSUS: no]'), false);
        assert.equal(parseConsensus('[Consensus: Yes]'), true);
    });
    it('allows whitespace around the keyword', () => {
        assert.equal(parseConsensus('[CONSENSUS:  YES]'), true);
    });
    it('returns null when no consensus marker present', () => {
        assert.equal(parseConsensus('All tasks done, everything looks good.'), null);
        assert.equal(parseConsensus(''), null);
    });
    it('picks up marker embedded in larger text', () => {
        const text = `I reviewed all the changes.
The implementation is correct and all tests pass.
No outstanding issues remain.
[CONSENSUS: YES]`;
        assert.equal(parseConsensus(text), true);
    });
    it('returns false for NO even with surrounding text', () => {
        assert.equal(parseConsensus('Still missing test coverage [CONSENSUS: NO] will fix'), false);
    });
});
describe('buildRoundPrompt', () => {
    const agent = { name: 'Composer', emoji: '🎼', persona: 'technical architect' };
    const branch = 'ensemble/Composer';
    it('round 1 includes scoring/planning header', () => {
        const prompt = buildRoundPrompt(1, 'build a CLI tool', null, '', [], agent, branch);
        assert.ok(prompt.includes('Round 1 — Scoring'));
        assert.ok(prompt.includes('plan.md'));
    });
    it('round 1 does not include implementation instructions', () => {
        const prompt = buildRoundPrompt(1, 'build a CLI tool', null, '', [], agent, branch);
        assert.ok(!prompt.includes('## Round Instructions'));
    });
    it('round 2+ includes implementation instructions not planning header', () => {
        const prompt = buildRoundPrompt(2, 'build a CLI tool', null, '', [], agent, branch);
        assert.ok(prompt.includes('## Round Instructions'));
        assert.ok(!prompt.includes('Round 1 — Scoring'));
    });
    it('includes plan content when provided in rounds 2+', () => {
        const plan = '- [ ] task one\n- [x] task two (Composer)';
        const prompt = buildRoundPrompt(2, 'task', plan, '', [], agent, branch);
        assert.ok(prompt.includes(plan));
        assert.ok(prompt.includes('## Current plan.md'));
    });
    it('omits plan section when plan is null', () => {
        const prompt = buildRoundPrompt(2, 'task', null, '', [], agent, branch);
        assert.ok(!prompt.includes('## Current plan.md'));
    });
    it('includes git log when non-empty', () => {
        const gitLog = 'abc1234 feat: initial commit\ndef5678 fix: typo';
        const prompt = buildRoundPrompt(1, 'task', null, gitLog, [], agent, branch);
        assert.ok(prompt.includes(gitLog));
        assert.ok(prompt.includes('## Recent git log'));
    });
    it('omits git log section when empty', () => {
        const prompt = buildRoundPrompt(1, 'task', null, '', [], agent, branch);
        assert.ok(!prompt.includes('## Recent git log'));
    });
    it('includes injected messages under Director cue section', () => {
        const prompt = buildRoundPrompt(2, 'task', null, '', ['focus on error handling', 'add retry logic'], agent, branch);
        assert.ok(prompt.includes("Director's Cue"));
        assert.ok(prompt.includes('focus on error handling'));
        assert.ok(prompt.includes('add retry logic'));
    });
    it('omits Director cue section when no injected messages', () => {
        const prompt = buildRoundPrompt(1, 'task', null, '', [], agent, branch);
        assert.ok(!prompt.includes("Director's Cue"));
    });
    it('always ends with consensus marker instructions', () => {
        for (const round of [1, 2, 5]) {
            const prompt = buildRoundPrompt(round, 'task', null, '', [], agent, branch);
            assert.ok(prompt.includes('[CONSENSUS: YES]'), `round ${round} missing YES`);
            assert.ok(prompt.includes('[CONSENSUS: NO]'), `round ${round} missing NO`);
        }
    });
    it('includes branch name in prompt', () => {
        const prompt = buildRoundPrompt(1, 'build a CLI', null, '', [], agent, branch);
        assert.ok(prompt.includes(branch));
    });
    it('includes task description in prompt', () => {
        const task = 'implement OAuth2 login with PKCE';
        const prompt = buildRoundPrompt(1, task, null, '', [], agent, branch);
        assert.ok(prompt.includes(task));
    });
    it('round number appears in heading', () => {
        const prompt = buildRoundPrompt(7, 'task', null, '', [], agent, branch);
        assert.ok(prompt.includes('Ensemble Round 7'));
    });
});
//# sourceMappingURL=ensemble.test.js.map