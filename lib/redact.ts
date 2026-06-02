/** Sensitive-input masking for the interaction trace (ADR Decision 3). */

const SENSITIVE_TYPES = new Set(['password']);
const SENSITIVE_NAME = /pass|pwd|secret|token|otp|cvv|cvc|card|ssn|credit|security[-_]?code/i;
const SENSITIVE_AUTOCOMPLETE = /password|cc-number|cc-csc|cc-exp|one-time-code/i;

export interface FieldInfo {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
}

export function isSensitiveField(f: FieldInfo): boolean {
  if (f.type && SENSITIVE_TYPES.has(f.type.toLowerCase())) return true;
  if (f.autocomplete && SENSITIVE_AUTOCOMPLETE.test(f.autocomplete)) return true;
  const haystack = `${f.name ?? ''} ${f.id ?? ''}`;
  return SENSITIVE_NAME.test(haystack);
}

/** Hide content while keeping the length signal. */
export function maskValue(value: string): string {
  if (value.length === 0) return '';
  return `••• (${value.length} chars)`;
}

/** Returns the value to record: masked if sensitive and masking is enabled. */
export function redactFieldValue(value: string, field: FieldInfo, maskEnabled: boolean): string {
  if (maskEnabled && isSensitiveField(field)) return maskValue(value);
  return value;
}
