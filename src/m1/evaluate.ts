// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { evaluateValidate, M1_RECEIPT_ITEM_LIMIT, M1_RECEIPT_TRACE_LIMIT, type ValidatedM1Context } from './validate.ts';
import { evaluateLink } from './link.ts';
import { evaluateTimebox } from './timebox.ts';
import { evaluateAdmit } from './admit.ts';
import { evaluateFacts } from './facts.ts';
import { buildM1Receipt, type M1Receipt } from './receipt.ts';
import { exposeInvalidInput, invalidInput } from './errors.ts';

export type M1EvaluationResult =
  | { ok: true; receipt: M1Receipt; context: ValidatedM1Context }
  | { ok: false; code: string; path: string; message: string };

export function evaluateEvidence(snapshotText: string, schemaText: string, policyText: string): M1EvaluationResult {
  try {
    const context = evaluateValidate(snapshotText, schemaText, policyText);
    if (context.snapshot.items.length > M1_RECEIPT_ITEM_LIMIT) {
      invalidInput('M1_RECEIPT_LIMIT', 'snapshot.items', `M1 evidence receipts support at most ${M1_RECEIPT_ITEM_LIMIT} items`);
    }
    if (context.snapshot.items.length > M1_RECEIPT_TRACE_LIMIT) {
      invalidInput('M1_RECEIPT_LIMIT', 'snapshot.items', `M1 evidence receipts with per-item traces support at most ${M1_RECEIPT_TRACE_LIMIT} items`);
    }
    for (const evidence of context.snapshot.evidence) {
      if (!context.schema.fields.some((f) => f.name === evidence.field)) {
        return { ok: false, code: 'INVALID_INPUT', path: `snapshot.evidence.${evidence.id}.field`, message: 'Unknown field' };
      }
    }
    const link = evaluateLink(context);
    const timebox = evaluateTimebox(context.snapshot.evidence, context.snapshot.asOf);
    const admit = evaluateAdmit(context);
    const facts = evaluateFacts(context, admit);
    const tracesByItem = new Map<string, { stage: string; status: string; codes: string[] }[]>();
    for (const item of context.snapshot.items) {
      tracesByItem.set(item.id, [
        { stage: 'Validate', status: 'OK', codes: [] },
        { stage: 'Link', status: link.issues.some((i) => i.itemId === item.id) ? 'ISSUES' : 'OK', codes: link.issues.filter((i) => i.itemId === item.id).map((i) => i.code) },
        { stage: 'Timebox', status: 'OK', codes: timebox.filter((t) => context.snapshot.evidence.some((e) => e.id === t.id && e.itemId === item.id)).map((t) => t.status) },
        { stage: 'Admit', status: 'OK', codes: admit.rows.filter((r) => r.evidence.itemId === item.id && r.status === 'EXCLUDED').flatMap((r) => r.codes) },
        { stage: 'Facts', status: 'OK', codes: facts.fields.filter((f) => f.itemId === item.id && f.state === 'CONFLICT').map(() => 'CONFLICT') },
      ]);
    }
    const receipt = buildM1Receipt(context, link.issues, admit, facts, tracesByItem);
    return { ok: true, receipt, context };
  } catch (error) {
    const exposed = exposeInvalidInput(error);
    return { ok: false, ...exposed };
  }
}

export { evaluateValidate as evaluateValidateStage } from './validate.ts';

export function evaluateLinkStage(snapshotText: string, schemaText: string, policyText: string) {
  return evaluateLink(evaluateValidate(snapshotText, schemaText, policyText));
}

export function evaluateTimeboxStage(snapshotText: string, schemaText: string, policyText: string) {
  const context = evaluateValidate(snapshotText, schemaText, policyText);
  return evaluateTimebox(context.snapshot.evidence, context.snapshot.asOf);
}

export function evaluateAdmitStage(snapshotText: string, schemaText: string, policyText: string) {
  return evaluateAdmit(evaluateValidate(snapshotText, schemaText, policyText));
}

export function evaluateFactsStage(snapshotText: string, schemaText: string, policyText: string) {
  const context = evaluateValidate(snapshotText, schemaText, policyText);
  const admit = evaluateAdmit(context);
  return evaluateFacts(context, admit);
}
