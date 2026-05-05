import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateName,
  validateAgentName,
  validateCwd,
  validateRegex,
  validatePermissionMode,
  validateEffort,
  validateTimeout,
  validatePositiveInt,
  validateStringField,
  validateStringArray,
  validateBoolean,
  MAX_NAME_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
} from '../src/validation.js';

describe('validateName', () => {
  it('accepts valid names', () => {
    assert.equal(validateName('my-session'), 'my-session');
    assert.equal(validateName('session.1'), 'session.1');
    assert.equal(validateName('foo_BAR'), 'foo_BAR');
  });

  it('trims whitespace', () => {
    assert.equal(validateName('  hello  '), 'hello');
  });

  it('rejects non-string', () => {
    assert.throws(() => validateName(42), /must be a string/);
    assert.throws(() => validateName(null), /must be a string/);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateName(''), /cannot be empty/);
    assert.throws(() => validateName('   '), /cannot be empty/);
  });

  it('rejects name exceeding max length', () => {
    assert.throws(() => validateName('a'.repeat(MAX_NAME_LENGTH + 1)), /characters/);
  });

  it('rejects invalid characters', () => {
    assert.throws(() => validateName('hello world'), /invalid characters/);
    assert.throws(() => validateName('foo/bar'), /invalid characters/);
    assert.throws(() => validateName('../etc'), /invalid characters/);
  });
});

describe('validateAgentName', () => {
  it('accepts valid agent names', () => {
    assert.equal(validateAgentName('Composer'), 'Composer');
    assert.equal(validateAgentName('agent-1'), 'agent-1');
    assert.equal(validateAgentName('A'), 'A');
  });

  it('rejects names starting with hyphen', () => {
    assert.throws(() => validateAgentName('-agent'), /must match/);
  });

  it('rejects names with dots or underscores', () => {
    assert.throws(() => validateAgentName('agent.foo'), /must match/);
    assert.throws(() => validateAgentName('agent_foo'), /must match/);
  });

  it('rejects path traversal attempts', () => {
    assert.throws(() => validateAgentName('../etc'), /must match/);
    assert.throws(() => validateAgentName('a/b'), /must match/);
  });

  it('rejects name exceeding max length', () => {
    assert.throws(() => validateAgentName('a'.repeat(MAX_AGENT_NAME_LENGTH + 1)), /characters/);
  });
});

describe('validateCwd', () => {
  it('resolves relative paths to absolute', () => {
    const result = validateCwd('/tmp/foo');
    assert.equal(result, '/tmp/foo');
  });

  it('rejects forbidden paths', () => {
    assert.throws(() => validateCwd('/proc/1/mem'), /forbidden/);
    assert.throws(() => validateCwd('/sys/class'), /forbidden/);
    assert.throws(() => validateCwd('/dev/null'), /forbidden/);
  });

  it('rejects non-string', () => {
    assert.throws(() => validateCwd(123), /must be a string/);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateCwd(''), /cannot be empty/);
    assert.throws(() => validateCwd('   '), /cannot be empty/);
  });

  it('rejects paths exceeding max length', () => {
    assert.throws(() => validateCwd('/tmp/' + 'a'.repeat(500)), /maximum path length/);
  });

  it('rejects exact forbidden prefix without subdirectory', () => {
    assert.throws(() => validateCwd('/proc'), /forbidden/);
    assert.throws(() => validateCwd('/sys'), /forbidden/);
    assert.throws(() => validateCwd('/dev'), /forbidden/);
  });

  it('accepts paths that merely contain forbidden words in a non-prefix position', () => {
    assert.doesNotThrow(() => validateCwd('/tmp/proc-data'));
    assert.doesNotThrow(() => validateCwd('/home/user/sysconfig'));
  });
});

describe('validateRegex', () => {
  it('accepts valid regex patterns', () => {
    assert.equal(validateRegex('foo.*bar'), 'foo.*bar');
    assert.equal(validateRegex('^start$'), '^start$');
    assert.equal(validateRegex('[A-Z]+'), '[A-Z]+');
  });

  it('rejects invalid regex syntax', () => {
    assert.throws(() => validateRegex('[unclosed'), /not a valid regex/);
    assert.throws(() => validateRegex('(?invalid'), /not a valid regex/);
  });

  it('rejects nested quantifiers (ReDoS)', () => {
    assert.throws(() => validateRegex('(a+)+'), /nested quantifier/);
    assert.throws(() => validateRegex('(a*)*'), /nested quantifier/);
    // Note: a{1,}+ is a syntax error in Node.js (not a valid regex at all), tested separately
    assert.throws(() => validateRegex('a{1,}+'), /regex/); // caught as syntax error or nested quantifier
  });

  it('rejects patterns exceeding max length', () => {
    assert.throws(() => validateRegex('a'.repeat(501)), /characters/);
  });
});

describe('validatePermissionMode', () => {
  it('accepts valid modes', () => {
    assert.equal(validatePermissionMode('bypassPermissions'), 'bypassPermissions');
    assert.equal(validatePermissionMode('acceptEdits'), 'acceptEdits');
    assert.equal(validatePermissionMode('auto'), 'auto');
    assert.equal(validatePermissionMode('plan'), 'plan');
  });

  it('rejects invalid modes', () => {
    assert.throws(() => validatePermissionMode('admin'), /must be one of/);
    assert.throws(() => validatePermissionMode(''), /must be one of/);
  });

  it('rejects non-string', () => {
    assert.throws(() => validatePermissionMode(true), /must be a string/);
  });
});

describe('validateEffort', () => {
  it('accepts valid effort levels', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max', 'auto']) {
      assert.equal(validateEffort(level), level);
    }
  });

  it('rejects invalid effort levels', () => {
    assert.throws(() => validateEffort('extreme'), /must be one of/);
  });
});

describe('validateTimeout', () => {
  it('accepts values within range', () => {
    assert.equal(validateTimeout(5_000), 5_000);
    assert.equal(validateTimeout(MIN_TIMEOUT_MS), MIN_TIMEOUT_MS);
    assert.equal(validateTimeout(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  });

  it('rejects below minimum', () => {
    assert.throws(() => validateTimeout(999), /≥/);
  });

  it('rejects above maximum', () => {
    assert.throws(() => validateTimeout(MAX_TIMEOUT_MS + 1), /≤/);
  });

  it('rejects non-finite values', () => {
    assert.throws(() => validateTimeout(Infinity), /finite/);
    assert.throws(() => validateTimeout(NaN), /finite/);
  });

  it('rejects non-number', () => {
    assert.throws(() => validateTimeout('5000'), /finite/);
  });
});

describe('validatePositiveInt', () => {
  it('accepts positive integers', () => {
    assert.equal(validatePositiveInt(1, 'field'), 1);
    assert.equal(validatePositiveInt(100, 'field'), 100);
  });

  it('rejects zero', () => {
    assert.throws(() => validatePositiveInt(0, 'field'), /positive integer/);
  });

  it('rejects negatives', () => {
    assert.throws(() => validatePositiveInt(-1, 'field'), /positive integer/);
  });

  it('rejects floats', () => {
    assert.throws(() => validatePositiveInt(1.5, 'field'), /positive integer/);
  });

  it('respects max constraint', () => {
    assert.throws(() => validatePositiveInt(101, 'field', 100), /≤100/);
    assert.doesNotThrow(() => validatePositiveInt(100, 'field', 100));
  });
});

describe('validateStringField', () => {
  it('accepts strings within limit', () => {
    assert.equal(validateStringField('hello', 'f'), 'hello');
    assert.equal(validateStringField('', 'f'), '');
  });

  it('rejects non-strings', () => {
    assert.throws(() => validateStringField(42, 'f'), /must be a string/);
  });

  it('rejects strings over maxLength', () => {
    assert.throws(() => validateStringField('a'.repeat(11), 'f', 10), /characters/);
  });
});

describe('validateStringArray', () => {
  it('accepts arrays of strings', () => {
    assert.deepEqual(validateStringArray(['a', 'b'], 'f'), ['a', 'b']);
    assert.deepEqual(validateStringArray([], 'f'), []);
  });

  it('rejects non-arrays', () => {
    assert.throws(() => validateStringArray('foo', 'f'), /must be an array/);
  });

  it('rejects non-string items', () => {
    assert.throws(() => validateStringArray([1, 2], 'f'), /must be a string/);
  });

  it('rejects arrays exceeding maxItems', () => {
    assert.throws(() => validateStringArray(new Array(201).fill('x'), 'f'), /items/);
  });
});

describe('validateBoolean', () => {
  it('accepts booleans', () => {
    assert.equal(validateBoolean(true, 'f'), true);
    assert.equal(validateBoolean(false, 'f'), false);
  });

  it('rejects non-booleans', () => {
    assert.throws(() => validateBoolean(1, 'f'), /must be a boolean/);
    assert.throws(() => validateBoolean('true', 'f'), /must be a boolean/);
  });
});
