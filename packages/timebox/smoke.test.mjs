import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './index.mjs';

const policy = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'P', version: '1', priorityOrder: 'ascending' });
const schema = JSON.stringify({ schemaVersion: 'commons.field-schema.v1', id: 'S', version: '1', fields: [] });
const snap = JSON.stringify({ schemaVersion: 'commons.evidence-snapshot.v1', asOf: '2026-10-09T12:00:00.000Z', items: [{ id: 'W', priority: 1, owner: 'o', dependsOn: [] }], sources: [], evidence: [] });

test('timebox bundled evaluate loads', () => {
  const out = evaluate(snap, schema, policy);
  assert.ok(out);
});
