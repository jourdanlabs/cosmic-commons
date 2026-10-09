// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256 } from '../../src/canonical.ts';
import { evaluateEvidence, evaluateValidateStage, evaluateAdmitStage, evaluateFactsStage } from '../../src/m1/evaluate.ts';
import { classifyInterval } from '../../src/m1/timebox.ts';
import { verifyM1ReceiptText } from '../../src/m1/replay.ts';
import { expectedDirectAdmissible } from './oracles/admit-truth-table.ts';
import { expectedFieldState } from './oracles/facts-state-oracle.ts';

const schemaText = JSON.stringify({
  schemaVersion: 'commons.field-schema.v1',
  id: 'SCHEMA-SYNTHETIC',
  version: '1',
  fields: [
    { name: 'approval', type: 'boolean', issuerAuthorities: ['authority-approval'], required: true, eligibility: false, disqualifier: false, owner: 'owner-approval' },
    { name: 'effort', type: 'integer', issuerAuthorities: ['authority-planning'], required: true, eligibility: false, disqualifier: false, owner: 'owner-planning' },
  ],
});
const policyText = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'POLICY-SYNTHETIC', version: '1', priorityOrder: 'ascending' });

function snapshotForEvidence(evidence: Record<string, unknown>) {
  return JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-1', content: { label: 'x' } }],
    evidence: [evidence],
  });
}

test('A01 oracle: exhaustive direct admit truth table', () => {
  const times = [
    { observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', asOf: '2026-10-09T12:00:00.000Z', status: 'CURRENT' as const },
    { observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', asOf: '2026-10-07T12:00:00.000Z', status: 'FUTURE' as const },
    { observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', asOf: '2026-10-10T12:00:00.000Z', status: 'EXPIRED' as const },
  ];
  for (const subjectMatches of [true, false]) {
    for (const issuerAuthorized of [true, false]) {
      for (const time of times) {
        const expected = expectedDirectAdmissible({ subjectMatches, issuerAuthorized, timeStatus: time.status });
        const snapshotText = JSON.stringify({
          schemaVersion: 'commons.evidence-snapshot.v1',
          asOf: time.asOf,
          items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
          sources: [{ id: 'SRC-1', content: { label: 'x' } }],
          evidence: [{
            id: 'EV-1',
            itemId: 'WORK-A',
            subjectId: subjectMatches ? 'WORK-A' : 'OTHER',
            field: 'approval',
            issuer: issuerAuthorized ? 'authority-approval' : 'wrong-issuer',
            sourceId: 'SRC-1',
            observedAt: time.observedAt,
            expiresAt: time.expiresAt,
            value: true,
            dependsOn: [],
          }],
        });
        assert.equal(classifyInterval(time.observedAt, time.expiresAt, time.asOf), time.status);
        const admit = evaluateAdmitStage(snapshotText, schemaText, policyText);
        const row = admit.rows[0];
        assert.equal(row.status === 'ADMITTED', expected, JSON.stringify({ subjectMatches, issuerAuthorized, time: time.status, codes: row.codes }));
      }
    }
  }
});

test('F01 oracle: field state from bounded admitted value sets', () => {
  const cases: { values: number[]; expect: 'KNOWN' | 'UNKNOWN' | 'CONFLICT' }[] = [
    { values: [], expect: 'UNKNOWN' },
    { values: [5], expect: 'KNOWN' },
    { values: [5, 5], expect: 'KNOWN' },
    { values: [5, 6], expect: 'CONFLICT' },
  ];
  for (const { values, expect } of cases) {
    const oracle = expectedFieldState(values.map((value) => ({ value, type: 'integer' })));
    assert.equal(oracle.state, expect);
    const evidence = values.map((value, index) => ({
      id: `EV-${index}`,
      itemId: 'WORK-A',
      subjectId: 'WORK-A',
      field: 'effort',
      issuer: 'authority-planning',
      sourceId: 'SRC-1',
      observedAt: '2026-10-08T12:00:00.000Z',
      expiresAt: '2026-10-10T12:00:00.000Z',
      value,
      dependsOn: [],
    }));
    const snapshotText = JSON.stringify({
      schemaVersion: 'commons.evidence-snapshot.v1',
      asOf: '2026-10-09T12:00:00.000Z',
      items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
      sources: [{ id: 'SRC-1', content: { label: 'x' } }],
      evidence,
    });
    const facts = evaluateFactsStage(snapshotText, schemaText, policyText);
    const field = facts.fields.find((f) => f.field === 'effort')!;
    assert.equal(field.state, expect);
  }
});

test('R03 replay matches valid receipt and rejects tamper', () => {
  const snapshotText = JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-APPROVAL', content: { label: 'a' } }],
    evidence: [
      { id: 'EV-APPROVAL', itemId: 'WORK-A', subjectId: 'WORK-A', field: 'approval', issuer: 'authority-approval', sourceId: 'SRC-APPROVAL', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: true, dependsOn: [] },
    ],
  });
  const built = evaluateEvidence(snapshotText, schemaText, policyText);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const text = canonicalize(built.receipt);
  const ok = verifyM1ReceiptText(text);
  assert.equal(ok.valid, true);
  assert.equal(ok.replay, 'MATCH');
  assert.equal(ok.anchoring, 'UNANCHORED');
  assert.ok(ok.issues.includes('UNANCHORED_SELF_CONSISTENCY_ONLY'));

  const parsed = JSON.parse(text) as Record<string, unknown>;
  parsed.items = (parsed.items as unknown[]).map((item) => ({ ...(item as object), evidenceStatus: 'COMPLETE' }));
  const forged = verifyM1ReceiptText(canonicalize(parsed));
  assert.equal(forged.valid, false);

  delete parsed.digest;
  parsed.digest = sha256(parsed);
  const rehashedForgery = verifyM1ReceiptText(canonicalize(parsed));
  assert.equal(rehashedForgery.integrity, 'VALID');
  assert.equal(rehashedForgery.replay, 'MISMATCH');
});

test('V02 order invariance: reversed items and evidence keep digest', () => {
  const items = [
    { id: 'W1', priority: 1, owner: 'o1', dependsOn: [] as string[] },
    { id: 'W2', priority: 2, owner: 'o2', dependsOn: [] as string[] },
  ];
  const evidence = [
    { id: 'E1', itemId: 'W1', subjectId: 'W1', field: 'approval', issuer: 'authority-approval', sourceId: 'SRC-1', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: true, dependsOn: [] },
    { id: 'E2', itemId: 'W2', subjectId: 'W2', field: 'effort', issuer: 'authority-planning', sourceId: 'SRC-1', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: 3, dependsOn: [] },
  ];
  const snapA = JSON.stringify({ schemaVersion: 'commons.evidence-snapshot.v1', asOf: '2026-10-09T12:00:00.000Z', items, sources: [{ id: 'SRC-1', content: { k: 1 } }], evidence });
  const snapB = JSON.stringify({ schemaVersion: 'commons.evidence-snapshot.v1', asOf: '2026-10-09T12:00:00.000Z', items: [...items].reverse(), sources: [{ id: 'SRC-1', content: { k: 1 } }], evidence: [...evidence].reverse() });
  const a = evaluateEvidence(snapA, schemaText, policyText);
  const b = evaluateEvidence(snapB, schemaText, policyText);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.receipt.digest, b.receipt.digest);
  assert.equal(verifyM1ReceiptText(canonicalize(b.receipt)).replay, 'MATCH');
});
