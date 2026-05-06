import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs } from '../src/session.js';
describe('buildArgs', () => {
    const base = {
        name: 'test',
        cwd: '/tmp',
        permissionMode: 'bypassPermissions',
    };
    it('always includes stream-json flags and bypassPermissions', () => {
        const args = buildArgs(base);
        assert.ok(args.includes('-p'));
        assert.ok(args.includes('--input-format'));
        assert.ok(args.includes('stream-json'));
        assert.ok(args.includes('--output-format'));
        assert.ok(args.includes('--permission-mode'));
        assert.ok(args.includes('bypassPermissions'));
    });
    it('includes model when specified', () => {
        const args = buildArgs({ ...base, model: 'claude-opus-4-7' });
        assert.ok(args.includes('--model'));
        assert.ok(args.includes('claude-opus-4-7'));
    });
    it('resolves model alias opus', () => {
        const args = buildArgs({ ...base, model: 'opus' });
        assert.ok(args.includes('claude-opus-4-7'));
    });
    it('resolves model alias sonnet', () => {
        const args = buildArgs({ ...base, model: 'sonnet' });
        assert.ok(args.includes('claude-sonnet-4-6'));
    });
    it('resolves model alias haiku', () => {
        const args = buildArgs({ ...base, model: 'haiku' });
        assert.ok(args.includes('claude-haiku-4-5-20251001'));
    });
    it('includes effort when not auto', () => {
        const args = buildArgs({ ...base, effort: 'high' });
        assert.ok(args.includes('--effort'));
        assert.ok(args.includes('high'));
    });
    it('omits effort when auto', () => {
        const args = buildArgs({ ...base, effort: 'auto' });
        assert.ok(!args.includes('--effort'));
    });
    it('includes maxTurns when set', () => {
        const args = buildArgs({ ...base, maxTurns: 10 });
        assert.ok(args.includes('--max-turns'));
        assert.ok(args.includes('10'));
    });
    it('includes appendSystemPrompt when set', () => {
        const args = buildArgs({ ...base, appendSystemPrompt: 'be terse' });
        assert.ok(args.includes('--append-system-prompt'));
        assert.ok(args.includes('be terse'));
    });
    it('includes resumeSessionId when set', () => {
        const args = buildArgs({ ...base, resumeSessionId: 'abc123' });
        assert.ok(args.includes('--resume'));
        assert.ok(args.includes('abc123'));
    });
    it('includes forkSession when both resume and fork set', () => {
        const args = buildArgs({ ...base, resumeSessionId: 'abc', forkSession: true });
        assert.ok(args.includes('--fork-session'));
    });
    it('does not include forkSession without resumeSessionId', () => {
        const args = buildArgs({ ...base, forkSession: true });
        assert.ok(!args.includes('--fork-session'));
    });
    it('includes allowedTools joined by comma', () => {
        const args = buildArgs({ ...base, allowedTools: ['Bash', 'Read'] });
        assert.ok(args.includes('--allowedTools'));
        const idx = args.indexOf('--allowedTools');
        assert.equal(args[idx + 1], 'Bash,Read');
    });
    it('includes disallowedTools joined by comma', () => {
        const args = buildArgs({ ...base, disallowedTools: ['Write'] });
        assert.ok(args.includes('--disallowedTools'));
        const idx = args.indexOf('--disallowedTools');
        assert.equal(args[idx + 1], 'Write');
    });
    it('handles single mcpConfig string', () => {
        const args = buildArgs({ ...base, mcpConfig: '/path/to/mcp.json' });
        assert.ok(args.includes('--mcp-config'));
        assert.ok(args.includes('/path/to/mcp.json'));
    });
    it('handles array mcpConfig', () => {
        const args = buildArgs({ ...base, mcpConfig: ['/a.json', '/b.json'] });
        const indices = args.reduce((acc, a, i) => (a === '--mcp-config' ? [...acc, i] : acc), []);
        assert.equal(indices.length, 2);
        assert.equal(args[indices[0] + 1], '/a.json');
        assert.equal(args[indices[1] + 1], '/b.json');
    });
    it('uses acceptEdits permissionMode', () => {
        const args = buildArgs({ ...base, permissionMode: 'acceptEdits' });
        const idx = args.indexOf('--permission-mode');
        assert.equal(args[idx + 1], 'acceptEdits');
    });
});
//# sourceMappingURL=session.test.js.map