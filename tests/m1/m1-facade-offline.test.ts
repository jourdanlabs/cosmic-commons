// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { packageRoot } from '../../src/package-root.ts';

const schemaText = JSON.stringify({
  schemaVersion: 'commons.field-schema.v1',
  id: 'S',
  version: '1',
  fields: [{ name: 'approval', type: 'boolean', issuerAuthorities: ['authority-approval'], required: true, eligibility: false, disqualifier: false, owner: 'o' }],
});
const policyText = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'P', version: '1', priorityOrder: 'ascending' });
const snapshotText = JSON.stringify({
  schemaVersion: 'commons.evidence-snapshot.v1',
  asOf: '2026-10-09T12:00:00.000Z',
  items: [{ id: 'WORK-A', priority: 1, owner: 'o', dependsOn: [] }],
  sources: [{ id: 'SRC-1', content: { k: 1 } }],
  evidence: [
    {
      id: 'EV-1',
      itemId: 'WORK-A',
      subjectId: 'WORK-A',
      field: 'approval',
      issuer: 'authority-approval',
      sourceId: 'SRC-1',
      observedAt: '2026-10-08T12:00:00.000Z',
      expiresAt: '2026-10-10T12:00:00.000Z',
      value: true,
      dependsOn: [],
    },
  ],
});

test('@cosmic/commons-m1-facade offline install evaluates valid fixture', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'commons-facade-'));
  let packedTarball = '';
  try {
    const pack = spawnSync('npm', ['pack', '--silent'], { cwd: join(packageRoot, 'packages', 'commons'), encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr);
    const tarball = pack.stdout.trim().split('\n').pop()!;
    packedTarball = join(packageRoot, 'packages', 'commons', tarball);
    const install = spawnSync('npm', ['install', '--offline', packedTarball], { cwd: consumer, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr + install.stdout);
    writeFileSync(
      join(consumer, 'run.mjs'),
      `import { evaluate } from '@cosmic/commons-m1-facade';\nconst r = evaluate(${JSON.stringify(snapshotText)}, ${JSON.stringify(schemaText)}, ${JSON.stringify(policyText)});\nif (!r.ok) { console.error(JSON.stringify(r)); process.exit(2); }\n`,
    );
    const run = spawnSync(process.execPath, ['run.mjs'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
    if (packedTarball) rmSync(packedTarball, { force: true });
  }
});
