import { describe, it, expect } from 'vitest';
import { isSensitiveField, maskValue, redactFieldValue } from './redact';

describe('isSensitiveField', () => {
  it('flags password type', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
  });

  it('flags sensitive names', () => {
    expect(isSensitiveField({ name: 'user_password' })).toBe(true);
    expect(isSensitiveField({ id: 'cardNumber' })).toBe(true);
    expect(isSensitiveField({ name: 'otp' })).toBe(true);
  });

  it('flags sensitive autocomplete tokens', () => {
    expect(isSensitiveField({ autocomplete: 'cc-number' })).toBe(true);
    expect(isSensitiveField({ autocomplete: 'one-time-code' })).toBe(true);
  });

  it('does not flag ordinary fields', () => {
    expect(isSensitiveField({ type: 'text', name: 'email' })).toBe(false);
    expect(isSensitiveField({ name: 'comment' })).toBe(false);
  });
});

describe('maskValue / redactFieldValue', () => {
  it('masks content but keeps length', () => {
    expect(maskValue('hunter2')).toBe('••• (7 chars)');
    expect(maskValue('')).toBe('');
  });

  it('masks sensitive fields only when enabled', () => {
    expect(redactFieldValue('hunter2', { type: 'password' }, true)).toBe('••• (7 chars)');
    expect(redactFieldValue('hunter2', { type: 'password' }, false)).toBe('hunter2');
    expect(redactFieldValue('hello', { type: 'text' }, true)).toBe('hello');
  });
});
