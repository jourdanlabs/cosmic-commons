// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidence, evaluateLinkStage, evaluateValidateStage } from '../../src/m1/evaluate.ts';
import { classifyInterval } from '../../src/m1/timebox.ts';
import { expectedMissingDependencies } from './oracles/link-missing-oracle.ts';
import { lexicalTimeboxStatus } from './oracles/timebox-lex-oracle.ts';

const schemaText = JSON.stringify({
  schemaVersion: 'commons.field-schema.v1',
  id: 'SCHEMA-SYNTHETIC',
  version: '1',
  fields: [
    { name: 'approval', type: 'boolean', issuerAuthorities: ['authority-approval'], required: true, eligibility: true, disqualifier: true, owner: 'owner-approval' },
    { name: 'effort', type: 'integer', issuerAuthorities: ['authority-planning'], required: true, eligibility: false, disqualifier: false, owner: 'owner-planning', unit: 'team-day' },
  ],
});
const policyText = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'POLICY-SYNTHETIC', version: '1', priorityOrder: 'ascending' });

test('T01 oracle: timebox matches lexical interval reference', () => {
  const cases = [
    ['2026-10-08T12:00:00.000Z', '2026-10-10T12:00:00.000Z', '2026-10-09T12:00:00.000Z', 'CURRENT'],
    ['2026-10-08T12:00:00.000Z', '2026-10-10T12:00:00.000Z', '2026-10-07T12:00:00.000Z', 'FUTURE'],
    ['2026-10-08T12:00:00.000Z', '2026-10-10T12:00:00.000Z', '2026-10-10T12:00:00.000Z', 'EXPIRED'],
  ] as const;
  for (const [observed, expires, asOf, expected] of cases) {
    assert.equal(classifyInterval(observed, expires, asOf), expected);
    assert.equal(lexicalTimeboxStatus(observed, expires, asOf), expected);
  }
});

test('L01 oracle: missing dependency set matches independent edge scan', () => {
  const snapshotText = JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-1', priority: 1, owner: 'o1', dependsOn: ['WORK-9'] }],
    sources: [{ id: 'S1', content: { x: 1 } }],
    evidence: [],
  });
  const ctx = evaluateValidateStage(snapshotText, schemaText, policyText);
  const link = evaluateLinkStage(snapshotText, schemaText, policyText);
  const oracle = expectedMissingDependencies(ctx.snapshot.items);
  assert.deepEqual(
    link.issues.filter((i) => i.code === 'MISSING_DEPENDENCY').map((i) => ({ itemId: i.itemId, missing: i.dependencyIds })),
    oracle,
  );
});

test('M1-C01 complete required evidence is not business approval (SC-01)', () => {
  const snapshotText = JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-APPROVAL', content: { label: 'a' } }, { id: 'SRC-EFFORT', content: { label: 'b' } }],
    evidence: [
      { id: 'EV-APPROVAL', itemId: 'WORK-A', subjectId: 'WORK-A', field: 'approval', issuer: 'authority-approval', sourceId: 'SRC-APPROVAL', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: true, dependsOn: [] },
      { id: 'EV-EFFORT', itemId: 'WORK-A', subjectId: 'WORK-A', field: 'effort', issuer: 'authority-planning', sourceId: 'SRC-EFFORT', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: 5, dependsOn: [] },
    ],
  });
  const result = evaluateEvidence(snapshotText, schemaText, policyText);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = result.receipt.items[0];
  assert.equal(item.evidenceStatus, 'COMPLETE');
  assert.equal(item.routingDisposition, null);
  assert.equal(item.finalDecision, null);
  assert.equal(item.finalDecisionStatus, 'NOT_EVALUATED');
});

test('M1-C02 missing required field routes NEEDS_EVIDENCE', () => {
  const snapshotText = JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-APPROVAL', content: { label: 'a' } }],
    evidence: [
      { id: 'EV-APPROVAL', itemId: 'WORK-A', subjectId: 'WORK-A', field: 'approval', issuer: 'authority-approval', sourceId: 'SRC-APPROVAL', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: true, dependsOn: [] },
    ],
  });
  const result = evaluateEvidence(snapshotText, schemaText, policyText);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receipt.items[0].evidenceStatus, 'INCOMPLETE');
  assert.equal(result.receipt.items[0].routingDisposition, 'NEEDS_EVIDENCE');
});

test('SC-04 typed boundary rejects string where integer required', () => {
  const snapshotText = JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-EFFORT', content: { label: 'b' } }],
    evidence: [
      { id: 'EV-EFFORT', itemId: 'WORK-A', subjectId: 'WORK-A', field: 'effort', issuer: 'authority-planning', sourceId: 'SRC-EFFORT', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: '5', dependsOn: [] },
    ],
  });
  const result = evaluateEvidence(snapshotText, schemaText, policyText);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'INVALID_INPUT');
});
