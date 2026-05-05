import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsensus } from '../src/council.js';

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
