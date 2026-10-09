// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { evaluateValidate, M1_RECEIPT_ITEM_LIMIT, M1_RECEIPT_TRACE_LIMIT } from "./validate.js";
import { evaluateLink } from "./link.js";
import { evaluateTimebox } from "./timebox.js";
import { evaluateAdmit } from "./admit.js";
import { evaluateFacts } from "./facts.js";
import { buildM1Receipt } from "./receipt.js";
import { exposeInvalidInput, invalidInput } from "./errors.js";
export function evaluateEvidence(snapshotText, schemaText, policyText) {
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
        const tracesByItem = new Map();
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
    }
    catch (error) {
        const exposed = exposeInvalidInput(error);
        return { ok: false, ...exposed };
    }
}
export { evaluateValidate as evaluateValidateStage } from "./validate.js";
export function evaluateLinkStage(snapshotText, schemaText, policyText) {
    return evaluateLink(evaluateValidate(snapshotText, schemaText, policyText));
}
export function evaluateTimeboxStage(snapshotText, schemaText, policyText) {
    const context = evaluateValidate(snapshotText, schemaText, policyText);
    return evaluateTimebox(context.snapshot.evidence, context.snapshot.asOf);
}
export function evaluateAdmitStage(snapshotText, schemaText, policyText) {
    return evaluateAdmit(evaluateValidate(snapshotText, schemaText, policyText));
}
export function evaluateFactsStage(snapshotText, schemaText, policyText) {
    const context = evaluateValidate(snapshotText, schemaText, policyText);
    const admit = evaluateAdmit(context);
    return evaluateFacts(context, admit);
}
