/**
 * Input validation and sanitization
 *
 * All public tool inputs pass through here before reaching business logic.
 * Throws descriptive errors on invalid input — callers get clean error messages.
 */
import * as path from 'node:path';

// ─── Limits ───────────────────────────────────────────────────────────────────

export const MAX_NAME_LENGTH = 100;
export const MAX_AGENT_NAME_LENGTH = 50;
export const MAX_CWD_LENGTH = 500;
export const MAX_REGEX_LENGTH = 500;
export const MAX_STRING_FIELD_LENGTH = 50_000;
export const MAX_TIMEOUT_MS = 24 * 60 * 60_000; // 24 h
export const MIN_TIMEOUT_MS = 1_000;             // 1 s

// ─── Patterns ─────────────────────────────────────────────────────────────────

// Session/plan names: letters, digits, hyphens, underscores, dots
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// Agent names used in git branch names and filesystem paths — strict subset
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const VALID_PERMISSION_MODES = new Set(['bypassPermissions', 'acceptEdits', 'auto', 'plan']);
const VALID_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);

// Paths that are never valid cwds for a coding agent
const FORBIDDEN_PATH_PREFIXES = ['/proc', '/sys', '/dev', '/run/user'];

// ─── Validators ───────────────────────────────────────────────────────────────

export function validateName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > MAX_NAME_LENGTH) throw new Error(`${field} must be ≤${MAX_NAME_LENGTH} characters`);
  if (!NAME_RE.test(v)) throw new Error(`${field} contains invalid characters (allowed: A-Z a-z 0-9 . _ -)`);
  return v;
}

export function validateAgentName(value: unknown, field = 'agent name'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > MAX_AGENT_NAME_LENGTH) throw new Error(`${field} must be ≤${MAX_AGENT_NAME_LENGTH} characters`);
  if (!AGENT_NAME_RE.test(v)) {
    throw new Error(`${field} must match [A-Za-z0-9][A-Za-z0-9-]* (safe for git branch names)`);
  }
  return v;
}

export function validateCwd(value: unknown, field = 'cwd'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!value.trim()) throw new Error(`${field} cannot be empty`);
  if (value.length > MAX_CWD_LENGTH) throw new Error(`${field} exceeds maximum path length`);
  const resolved = path.resolve(value);
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
      throw new Error(`${field} points to a forbidden system path: ${resolved}`);
    }
  }
  return resolved;
}

export function validateRegex(value: unknown, field = 'pattern'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > MAX_REGEX_LENGTH) throw new Error(`${field} must be ≤${MAX_REGEX_LENGTH} characters`);
  // Syntax check
  try {
    new RegExp(value);
  } catch (e) {
    throw new Error(`${field} is not a valid regex: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Reject nested quantifiers — the most common ReDoS pattern
  if (/(\+\+|\*\*|\{[^}]+\}\s*[+*]|\([^)]*[+*][^)]*\)\s*[+*{])/.test(value)) {
    throw new Error(`${field} contains a nested quantifier that could cause catastrophic backtracking`);
  }
  return value;
}

export function validatePermissionMode(value: unknown, field = 'permissionMode'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!VALID_PERMISSION_MODES.has(value)) {
    throw new Error(`${field} must be one of: ${[...VALID_PERMISSION_MODES].join(', ')}`);
  }
  return value;
}

export function validateEffort(value: unknown, field = 'effort'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!VALID_EFFORT_LEVELS.has(value)) {
    throw new Error(`${field} must be one of: ${[...VALID_EFFORT_LEVELS].join(', ')}`);
  }
  return value;
}

export function validateTimeout(value: unknown, field = 'timeout'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (value < MIN_TIMEOUT_MS) throw new Error(`${field} must be ≥${MIN_TIMEOUT_MS}ms`);
  if (value > MAX_TIMEOUT_MS) throw new Error(`${field} must be ≤${MAX_TIMEOUT_MS}ms`);
  return value;
}

export function validatePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  if (max !== undefined && value > max) throw new Error(`${field} must be ≤${max}`);
  return value;
}

export function validateStringField(value: unknown, field: string, maxLength = MAX_STRING_FIELD_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} must be ≤${maxLength} characters`);
  return value;
}

export function validateStringArray(value: unknown, field: string, maxItems = 200): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > maxItems) throw new Error(`${field} must have ≤${maxItems} items`);
  return value.map((item, i) => {
    if (typeof item !== 'string') throw new Error(`${field}[${i}] must be a string`);
    return item;
  });
}

export function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value;
}
