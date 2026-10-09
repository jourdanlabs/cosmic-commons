// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../../src/package-root.ts';
import { evaluateEvidence } from '../../src/m1/evaluate.ts';

const fixture = JSON.parse(readFileSync(join(packageRoot, 'tests/fixtures/m1-contract-examples.json'), 'utf8')) as {
  cases: { id: string; input: { snapshot: unknown; schema: unknown; policy: unknown } }[];
  rawTextCases?: { id: string; snapshotText: string; schemaText?: string; policyText?: string }[];
};

const S = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));
type Ok = Extract<Awaited<ReturnType<typeof evaluateEvidence>>, { ok: true }>;
type Item = Ok['receipt']['items'][0];

const fact = (it: Item, f: string) => it.facts.find((x) => x.field === f);
const excl = (it: Item, id: string, code: string) =>
  it.reasons.some((r) => r.engine === 'Admit' && r.evidenceIds.includes(id) && r.question.includes(code));
const noFinal = (it: Item) => it.finalDecision === null && it.finalDecisionStatus === 'NOT_EVALUATED';

const checks: Record<string, (r: Ok | { ok: false; code: string; message: string }) => boolean> = {
  'M1-C01': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return (
      fact(it, 'approval')?.state === 'KNOWN' &&
      fact(it, 'effort')?.value === 5 &&
      fact(it, 'note')?.state === 'UNKNOWN' &&
      it.evidenceStatus === 'COMPLETE' &&
      it.routingDisposition === null &&
      noFinal(it) &&
      r.receipt.requiredCount === 2
    );
  },
  'M1-C02': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return (
      fact(it, 'effort')!.state === 'UNKNOWN' &&
      it.routingDisposition === 'NEEDS_EVIDENCE' &&
      it.reasons.some((x) => x.owner === 'owner-planning' && x.question.includes('effort')) &&
      noFinal(it)
    );
  },
  'M1-C03': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    const f = fact(it, 'effort')!;
    return (
      f.state === 'CONFLICT' &&
      !('value' in f) &&
      f.evidenceIds.includes('EV-EFFORT') &&
      f.evidenceIds.includes('EV-EFFORT-OTHER') &&
      it.reasons.some((x) => x.owner === 'owner-planning' && x.code === 'FIELD_CONFLICT')
    );
  },
  'M1-C04': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return excl(it, 'EV-EFFORT-UNAUTHORIZED', 'UNAUTHORIZED_ISSUER') && fact(it, 'effort')!.state === 'KNOWN' && fact(it, 'effort')!.value === 5;
  },
  'M1-C05': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return (
      excl(it, 'EV-EFFORT', 'UNAUTHORIZED_ISSUER') &&
      fact(it, 'effort')!.state === 'UNKNOWN' &&
      it.routingDisposition === 'NEEDS_EVIDENCE' &&
      it.reasons.some((x) => x.owner === 'owner-planning')
    );
  },
  'M1-C06': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return excl(it, 'EV-EFFORT', 'WRONG_SUBJECT') && fact(it, 'effort')!.state === 'UNKNOWN';
  },
  'M1-C07': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return excl(it, 'EV-EFFORT', 'EXPIRED') && fact(it, 'effort')!.state === 'UNKNOWN';
  },
  'M1-C08': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return fact(it, 'effort')!.state === 'KNOWN' && fact(it, 'effort')!.value === 5;
  },
  'M1-C09': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return excl(it, 'EV-EFFORT', 'FUTURE');
  },
  'M1-C10': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return (
      it.reasons.some(
        (x) => x.code === 'MISSING_DEPENDENCY' && x.dependencyIds.includes('WORK-MISSING') && x.owner === 'owner-work-a',
      ) && it.routingDisposition === 'NEEDS_EVIDENCE'
    );
  },
  'M1-C11': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return it.reasons.some((x) => x.code === 'DEPENDENCY_CYCLE') && noFinal(it);
  },
  'M1-C12': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    return fact(it, 'approval')!.state === 'KNOWN' && fact(it, 'approval')!.value === false && fact(it, 'effort')!.state === 'UNKNOWN' && noFinal(it);
  },
  'M1-C13': (r) => !r.ok && r.code === 'INVALID_INPUT',
  'M1-C14': (r) => {
    if (!r.ok) return false;
    const it = r.receipt.items[0];
    const reasonChild = it.reasons.find((x) => x.evidenceIds.includes('EV-EFFORT'));
    return (
      excl(it, 'EV-PREREQUISITE', 'UNAUTHORIZED_ISSUER') &&
      fact(it, 'effort')!.state === 'UNKNOWN' &&
      !!reasonChild &&
      !/MISSING_DEPENDENCY/.test(JSON.stringify(reasonChild))
    );
  },
  'M1-C15': (r) => {
    if (!r.ok) return false;
    return r.receipt.requiredCount === 0 && r.receipt.knownRequired === 0 && noFinal(r.receipt.items[0]);
  },
  'M1-C16': (r) => !r.ok && /DUPLICATE/.test(r.message + r.code),
};

test('M1 contract examples (hand-written properties; kills Facts M5)', () => {
  for (const c of fixture.cases) {
    const r = evaluateEvidence(S(c.input.snapshot), S(c.input.schema), S(c.input.policy));
    if (c.id === 'M1-C13' || c.id === 'M1-C16') {
      assert.equal(checks[c.id](r), true, c.id);
    } else {
      assert.ok(r.ok, `${c.id}: ${!r.ok ? r.code + ' ' + r.message : ''}`);
      assert.equal(checks[c.id](r), true, c.id);
    }
  }
  const base = fixture.cases[0].input;
  for (const c of fixture.rawTextCases ?? []) {
    const r = evaluateEvidence(c.snapshotText, c.schemaText ?? S(base.schema), c.policyText ?? S(base.policy));
    assert.equal(checks[c.id](r), true, c.id);
  }
});
