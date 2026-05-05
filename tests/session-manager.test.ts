/**
 * SessionManager unit tests — pure-logic paths that don't require subprocess I/O.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager.js';

// ─── Initialization ────────────────────────────────────────────────────────────

describe('SessionManager initialization', () => {
  it('constructs without error and shuts down cleanly', async () => {
    const mgr = new SessionManager({}, () => {});
    await mgr.shutdown();
  });

  it('listSessions returns empty array on fresh instance', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.deepEqual(mgr.listSessions(), []);
    await mgr.shutdown();
  });

  it('listPersistedSessions returns an array (may have disk-resident sessions)', async () => {
    const mgr = new SessionManager({}, () => {});
    const sessions = mgr.listPersistedSessions();
    assert.ok(Array.isArray(sessions));
    await mgr.shutdown();
  });

  it('health returns valid structure with zero sessions', async () => {
    const mgr = new SessionManager({}, () => {});
    const h = mgr.health() as { ok: boolean; sessions: number; sessionNames: string[]; circuitBreaker: object };
    assert.equal(h.ok, true);
    assert.equal(h.sessions, 0);
    assert.deepEqual(h.sessionNames, []);
    assert.ok(typeof h.circuitBreaker === 'object');
    await mgr.shutdown();
  });
});

// ─── Ensemble state management ────────────────────────────────────────────────

describe('SessionManager ensemble state', () => {
  it('ensembleStatus returns undefined for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.equal(mgr.ensembleStatus('00000000-0000-0000-0000-000000000000'), undefined);
    await mgr.shutdown();
  });

  it('ensembleAbort on unknown id logs but does not throw', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.doesNotThrow(() => mgr.ensembleAbort('nonexistent'));
    await mgr.shutdown();
  });

  it('ensembleInject throws for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.throws(() => mgr.ensembleInject('nonexistent', 'hello'), /not found/i);
    await mgr.shutdown();
  });

  it('ensembleReview throws for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.throws(() => mgr.ensembleReview('nonexistent'), /not found/i);
    await mgr.shutdown();
  });

  it('ensembleAccept throws for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.throws(() => mgr.ensembleAccept('nonexistent'), /not found/i);
    await mgr.shutdown();
  });

  it('ensembleReject throws for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.throws(() => mgr.ensembleReject('nonexistent', 'bad work'), /not found/i);
    await mgr.shutdown();
  });
});

// ─── Ultraplan / Ultrareview state ────────────────────────────────────────────

describe('SessionManager ultraplan/ultrareview state', () => {
  it('ultraplanStatus returns undefined for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.equal(mgr.ultraplanStatus('nonexistent'), undefined);
    await mgr.shutdown();
  });

  it('ultrareviewStatus returns undefined for unknown id', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.equal(mgr.ultrareviewStatus('nonexistent'), undefined);
    await mgr.shutdown();
  });
});

// ─── Agent listing ────────────────────────────────────────────────────────────

describe('SessionManager listAgents', () => {
  it('returns empty array for a directory with no .claude/agents/', async () => {
    const mgr = new SessionManager({}, () => {});
    const agents = mgr.listAgents('/tmp');
    assert.deepEqual(agents, []);
    await mgr.shutdown();
  });
});

// ─── Session operations without subprocess ────────────────────────────────────

describe('SessionManager session guards', () => {
  it('getStatus throws for unknown session name', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.throws(() => mgr.getStatus('nonexistent'), /not found/);
    await mgr.shutdown();
  });

  it('stopSession on unknown name resolves without error', async () => {
    const mgr = new SessionManager({}, () => {});
    await assert.doesNotReject(() => mgr.stopSession('nonexistent'));
    await mgr.shutdown();
  });

  it('sendMessage throws for unknown session name', async () => {
    const mgr = new SessionManager({}, () => {});
    await assert.rejects(() => mgr.sendMessage('ghost', 'hello'), /not found/);
    await mgr.shutdown();
  });

  it('switchModel throws for unknown session name', async () => {
    const mgr = new SessionManager({}, () => {});
    await assert.rejects(() => mgr.switchModel('ghost', 'opus'), /not found/);
    await mgr.shutdown();
  });

  it('compactSession throws for unknown session name', async () => {
    const mgr = new SessionManager({}, () => {});
    await assert.rejects(() => mgr.compactSession('ghost'), /not found/);
    await mgr.shutdown();
  });

  it('grepSession throws for unknown session name', async () => {
    const mgr = new SessionManager({}, () => {});
    await assert.rejects(() => mgr.grepSession('ghost', 'foo'), /not found/);
    await mgr.shutdown();
  });
});

// ─── Plugin config application ────────────────────────────────────────────────

describe('SessionManager plugin config', () => {
  it('respects maxConcurrentSessions from config', async () => {
    const mgr = new SessionManager({ maxConcurrentSessions: 3 }, () => {});
    assert.equal(mgr.config.maxConcurrentSessions, 3);
    await mgr.shutdown();
  });

  it('respects claudeBin from config', async () => {
    const mgr = new SessionManager({ claudeBin: '/usr/local/bin/claude' }, () => {});
    assert.equal(mgr.config.claudeBin, '/usr/local/bin/claude');
    await mgr.shutdown();
  });

  it('defaults to bypassPermissions when not specified', async () => {
    const mgr = new SessionManager({}, () => {});
    assert.equal(mgr.config.defaultPermissionMode, 'bypassPermissions');
    await mgr.shutdown();
  });

  it('respects sessionTtlMinutes from config', async () => {
    const mgr = new SessionManager({ sessionTtlMinutes: 30 }, () => {});
    assert.equal(mgr.config.sessionTtlMinutes, 30);
    await mgr.shutdown();
  });
});
