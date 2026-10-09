// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidence } from "../../src/m1/evaluate.js";
import { verifyM1ReceiptText } from "../../src/m1/replay.js";
import { canonicalize } from "../../src/canonical.js";
import { M1_RECEIPT_ITEM_LIMIT, M1_RECEIPT_TRACE_LIMIT } from "../../src/m1/validate.js";
const schemaText = JSON.stringify({
    schemaVersion: 'commons.field-schema.v1',
    id: 'S',
    version: '1',
    fields: [{ name: 'approval', type: 'boolean', issuerAuthorities: ['a'], required: false, eligibility: false, disqualifier: false, owner: 'o' }],
});
const policyText = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'P', version: '1', priorityOrder: 'ascending' });
function snapshotWithItems(n) {
    return JSON.stringify({
        schemaVersion: 'commons.evidence-snapshot.v1',
        asOf: '2026-10-09T12:00:00.000Z',
        items: Array.from({ length: n }, (_, i) => ({ id: `W${i}`, priority: i + 1, owner: 'o', dependsOn: [] })),
        sources: [],
        evidence: [],
    });
}
test('evaluateEvidence refuses receipts above trace and item ceilings', () => {
    const overTrace = evaluateEvidence(snapshotWithItems(M1_RECEIPT_TRACE_LIMIT + 1), schemaText, policyText);
    assert.equal(overTrace.ok, false);
    if (overTrace.ok)
        return;
    assert.equal(overTrace.code, 'M1_RECEIPT_LIMIT');
    const overItems = evaluateEvidence(snapshotWithItems(M1_RECEIPT_ITEM_LIMIT + 1), schemaText, policyText);
    assert.equal(overItems.ok, false);
    if (overItems.ok)
        return;
    assert.equal(overItems.code, 'M1_RECEIPT_LIMIT');
});
test('max-size receipt verifies after build', () => {
    const built = evaluateEvidence(snapshotWithItems(M1_RECEIPT_TRACE_LIMIT), schemaText, policyText);
    assert.equal(built.ok, true);
    if (!built.ok)
        return;
    assert.ok(built.receipt.items[0]?.traces.length > 0);
    const verified = verifyM1ReceiptText(canonicalize(built.receipt));
    assert.equal(verified.valid, true);
    assert.equal(verified.replay, 'MATCH');
});
