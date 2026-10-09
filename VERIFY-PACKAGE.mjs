// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
// Integrity check only: a manifest is not a signature or an independent anchor.
// Verify a clean git clone or release archive; dev trees with node_modules may fail structurally.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInventory, releaseInventorySkipped, readManifestMap, MANIFEST } from './scripts/package-inventory.mjs';

function fail(reason) {
  console.log(JSON.stringify({ valid: false, reason, manifest: MANIFEST, authenticity: 'NOT_ESTABLISHED' }));
  process.exit(1);
}

try {
  const root = fileURLToPath(new URL('./', import.meta.url));
  const allowDevDependencies = process.argv.includes('--allow-dev-dependencies');
  const verifyOptions = { allowDevDependencies };
  const expected = readManifestMap(root);
  const actual = releaseInventory(root, verifyOptions);
  const actualSet = new Set(actual);
  for (const path of actual) {
    let stat;
    try {
      stat = lstatSync(join(root, path));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        fail('Missing file: ' + path);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) fail('Symlink refused: ' + path);
    if (!stat.isFile()) fail('Not a regular file: ' + path);
    if (!expected.has(path)) fail('Unexpected file: ' + path);
    const digest = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    if (digest !== expected.get(path)) fail('Checksum mismatch: ' + path);
  }
  for (const path of expected.keys()) {
    if (!actualSet.has(path)) fail('Missing file: ' + path);
  }
  const result = { valid: true, files: actual.length, manifest: MANIFEST, authenticity: 'NOT_ESTABLISHED' };
  const skipped = releaseInventorySkipped(root, verifyOptions);
  if (skipped.length) result.skipped = skipped;
  console.log(JSON.stringify(result));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
