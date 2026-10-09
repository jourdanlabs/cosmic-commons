// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { inspectEvidence } from '../src/evidence.ts';
import { evaluatePolicy } from '../src/policy.ts';

const asOf = '2026-10-09T12:00:00.000Z';
const baseFact = { id: 'F1', sourceId: 'SRC-1', value: true };
const baseBundle = { sources: [{ id: 'SRC-1', content: { ok: true } }], facts: [baseFact] };
const policyInput = {
  id: 'P1',
  version: '1',
  rules: [{ id: 'R1', factId: 'F1', op: 'eq' as const, value: true }],
};

const cases: { label: string; value: unknown }[] = [
  { label: 'empty array', value: [] },
  { label: 'null', value: null },
  { label: 'number', value: 5 },
  { label: 'string', value: 'x' },
  { label: 'array-like object', value: { length: 1, 0: 'F1' } },
];

async function loadBaseline(baselineZip: string) {
  const dir = mkdtempSync(join(tmpdir(), 'commons-022-'));
  execSync(`unzip -q "${baselineZip}" "cosmic-commons-0.2.2-public/dist/src/*" -d "${dir}"`);
  const srcRoot = join(dir, 'cosmic-commons-0.2.2-public/dist/src');
  const baselineEvidence = await import(pathToFileURL(join(srcRoot, 'evidence.js')).href);
  const baselinePolicy = await import(pathToFileURL(join(srcRoot, 'policy.js')).href);
  return { dir, baselineEvidence, baselinePolicy };
}

test('admissionExcluded matches frozen 0.2.2 policy path (MALFORMED/ERROR, not ALLOW)', async (t) => {
  const baselineZip = process.env.COMMONS_BASELINE_ZIP;
  if (!baselineZip) {
    t.skip('baseline 0.2.2 zip not provided (set COMMONS_BASELINE_ZIP)');
    return;
  }
  const { dir, baselineEvidence, baselinePolicy } = await loadBaseline(baselineZip);
  try {
    for (const c of cases) {
      const bundle = { sources: baseBundle.sources, facts: [{ ...baseFact, admissionExcluded: c.value }] };
      const baselineReport = baselineEvidence.inspectEvidence(bundle, asOf);
      assert.equal(baselineReport.valid, false, c.label);
      assert.ok(baselineReport.issues.some((i: { code: string }) => i.code === 'MALFORMED_EVIDENCE'), c.label);

      const currentReport = inspectEvidence(bundle as never, asOf);
      assert.equal(currentReport.valid, false, c.label);
      assert.ok(currentReport.issues.some((i) => i.code === 'MALFORMED_EVIDENCE'), c.label);

      const baselineVerdict = baselinePolicy.evaluatePolicy(policyInput, bundle, asOf);
      const currentVerdict = evaluatePolicy(policyInput, bundle as never, asOf);
      assert.equal(baselineVerdict.verdict, 'ERROR', c.label);
      assert.equal(currentVerdict.verdict, 'ERROR', c.label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
