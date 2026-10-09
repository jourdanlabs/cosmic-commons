// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0

export class M1InvalidInputError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = 'M1InvalidInputError';
    this.code = code;
    this.path = path;
  }
}

export function invalidInput(code: string, path: string, message: string): never {
  throw new M1InvalidInputError(code, path, message);
}

export function exposeInvalidInput(error: unknown): { code: string; path: string; message: string } {
  if (error instanceof M1InvalidInputError) return { code: error.code, path: error.path, message: error.message };
  if (error instanceof TypeError) return { code: 'INVALID_INPUT', path: '', message: error.message };
  return { code: 'INVALID_INPUT', path: '', message: error instanceof Error ? error.message : String(error) };
}
