// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { exactKeys } from '../evidence.ts';
import type { FieldType } from './validate.ts';
import { invalidInput } from './errors.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function assertTypedFieldValue(value: unknown, type: FieldType, path: string): void {
  if (type === 'boolean') {
    if (typeof value !== 'boolean') invalidInput('INVALID_INPUT', path, 'Expected boolean value');
    return;
  }
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalidInput('INVALID_INPUT', path, 'Expected safe integer value');
    return;
  }
  if (type === 'nonempty-string') {
    if (typeof value !== 'string' || !/\S/.test(value)) invalidInput('INVALID_INPUT', path, 'Expected nonempty string value');
    return;
  }
  if (!isRecord(value)) invalidInput('INVALID_INPUT', path, 'Expected integer-range object');
  exactKeys(value, ['low', 'high'], 'integer-range');
  if (typeof value.low !== 'number' || typeof value.high !== 'number' || !Number.isSafeInteger(value.low) || !Number.isSafeInteger(value.high)) {
    invalidInput('INVALID_INPUT', path, 'Range bounds must be safe integers');
  }
  if (value.low > value.high) invalidInput('INVALID_RANGE', path, 'Range low must not exceed high');
}

/** Independent canonical equality for oracle tests (not importing production canonicalize for expected state). */
export function typedValueIdentity(value: unknown, type: FieldType): string {
  if (type === 'integer-range' && isRecord(value)) return `range:${value.low}:${value.high}`;
  return `${type}:${JSON.stringify(value)}`;
}
