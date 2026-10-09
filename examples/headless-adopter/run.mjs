#!/usr/bin/env node
import { evaluate } from '../../packages/validate/index.mjs';
import { evaluateEvidence } from '../../packages/commons/index.mjs';

const schema = JSON.stringify({
  schemaVersion: 'commons.field-schema.v1',
  id: 'demo',
  version: '1',
  fields: [{ name: 'flag', type: 'boolean', issuerAuthorities: ['a'], required: true, eligibility: false, disqualifier: false, owner: 'o' }],
});
const policy = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'p', version: '1', priorityOrder: 'ascending' });
const snapshot = JSON.stringify({
  schemaVersion: 'commons.evidence-snapshot.v1',
  asOf: '2026-10-09T12:00:00.000Z',
  items: [{ id: 'I1', priority: 1, owner: 'o', dependsOn: [] }],
  sources: [{ id: 'S1', content: { k: 1 } }],
  evidence: [{ id: 'E1', itemId: 'I1', subjectId: 'I1', field: 'flag', issuer: 'a', sourceId: 'S1', observedAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-10T12:00:00.000Z', value: true, dependsOn: [] }],
});
evaluate(snapshot, schema, policy);
const out = evaluateEvidence(snapshot, schema, policy);
if (!out.ok) process.exit(1);
console.log(JSON.stringify({ valid: true, item: out.receipt.items[0].evidenceStatus }));
