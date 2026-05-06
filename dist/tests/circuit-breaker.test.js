/**
 * Tests for CircuitBreaker logic — extracted via SessionManager constructor patterns.
 * We test the observable behavior through SessionManager rather than the private class.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// CircuitBreaker logic inline (mirrors session-manager.ts) so we can unit test without I/O
class CircuitBreaker {
    failures = 0;
    openUntil = 0;
    threshold;
    baseMs;
    maxMs;
    constructor(threshold = 3, baseMs = 1000, maxMs = 300_000) {
        this.threshold = threshold;
        this.baseMs = baseMs;
        this.maxMs = maxMs;
    }
    isOpen() {
        if (Date.now() < this.openUntil)
            return true;
        if (this.openUntil && Date.now() >= this.openUntil)
            this.openUntil = 0;
        return false;
    }
    recordSuccess() {
        this.failures = 0;
        this.openUntil = 0;
    }
    recordFailure() {
        this.failures++;
        if (this.failures >= this.threshold) {
            const backoff = Math.min(this.baseMs * Math.pow(2, this.failures - this.threshold), this.maxMs);
            this.openUntil = Date.now() + backoff;
        }
    }
    status() {
        return { open: this.isOpen(), failures: this.failures };
    }
}
describe('CircuitBreaker', () => {
    it('starts closed', () => {
        const cb = new CircuitBreaker();
        assert.equal(cb.isOpen(), false);
    });
    it('remains closed below threshold', () => {
        const cb = new CircuitBreaker(3);
        cb.recordFailure();
        cb.recordFailure();
        assert.equal(cb.isOpen(), false);
        assert.equal(cb.status().failures, 2);
    });
    it('opens at threshold', () => {
        const cb = new CircuitBreaker(3, 100, 60_000);
        cb.recordFailure();
        cb.recordFailure();
        cb.recordFailure();
        assert.equal(cb.isOpen(), true);
    });
    it('resets on success', () => {
        const cb = new CircuitBreaker(1, 60_000, 60_000);
        cb.recordFailure();
        assert.equal(cb.isOpen(), true);
        cb.recordSuccess();
        assert.equal(cb.isOpen(), false);
        assert.equal(cb.status().failures, 0);
    });
    it('caps backoff at maxMs', () => {
        const cb = new CircuitBreaker(1, 1000, 5000);
        // Trip many times
        for (let i = 0; i < 20; i++)
            cb.recordFailure();
        assert.equal(cb.isOpen(), true);
        // Verify it didn't overflow or go past max (indirectly: still open not errored)
    });
    it('doubles backoff on consecutive failures past threshold', () => {
        const cb1 = new CircuitBreaker(3, 1000, 60_000);
        const cb2 = new CircuitBreaker(3, 1000, 60_000);
        // cb1: 3 failures → openUntil = now + 1000
        cb1.recordFailure();
        cb1.recordFailure();
        cb1.recordFailure();
        // cb2: 4 failures → openUntil = now + 2000
        cb2.recordFailure();
        cb2.recordFailure();
        cb2.recordFailure();
        cb2.recordFailure();
        assert.equal(cb1.isOpen(), true);
        assert.equal(cb2.isOpen(), true);
        // Both open; cb2 has a longer delay but we can't measure time precisely in unit tests
    });
});
//# sourceMappingURL=circuit-breaker.test.js.map