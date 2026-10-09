// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { inspectEvidence } from "../evidence.js";
import { fieldClaimKey } from "./claim-key.js";
import { classifyInterval } from "./timebox.js";
import { assertTypedFieldValue } from "./typed-value.js";
function fieldDef(context, name) {
    return context.schema.fields.find((f) => f.name === name);
}
function toFact(row, unit, admissionExcluded) {
    return {
        id: row.id,
        sourceId: row.sourceId,
        value: row.value,
        claimId: fieldClaimKey(row.itemId, row.field),
        ...(unit ? { unit } : {}),
        observedAt: row.observedAt,
        expiresAt: row.expiresAt,
        dependsOn: row.dependsOn,
        ...(admissionExcluded?.length ? { admissionExcluded: [...admissionExcluded].sort() } : {}),
    };
}
function buildBundle(context, rows) {
    return {
        sources: context.snapshot.sources,
        facts: context.snapshot.evidence.map((evidence) => {
            const row = rows.find((r) => r.evidence.id === evidence.id);
            const field = fieldDef(context, evidence.field);
            const codes = row.status === 'EXCLUDED' && row.boundaryExcluded ? row.codes : undefined;
            return toFact(evidence, field?.unit, codes);
        }),
    };
}
export function evaluateAdmit(context) {
    const rows = [];
    for (const evidence of context.snapshot.evidence) {
        const codes = [];
        const field = fieldDef(context, evidence.field);
        if (!field) {
            codes.push('UNKNOWN_FIELD');
        }
        else {
            assertTypedFieldValue(evidence.value, field.type, `snapshot.evidence.${evidence.id}.value`);
            if (evidence.subjectId !== evidence.itemId)
                codes.push('WRONG_SUBJECT');
            if (!field.issuerAuthorities.includes(evidence.issuer))
                codes.push('UNAUTHORIZED_ISSUER');
            const time = classifyInterval(evidence.observedAt, evidence.expiresAt, context.snapshot.asOf);
            if (time === 'EXPIRED')
                codes.push('EXPIRED');
            if (time === 'FUTURE')
                codes.push('FUTURE');
        }
        if (codes.length) {
            rows.push({ evidence, status: 'EXCLUDED', codes: [...new Set(codes)].sort(), boundaryExcluded: true });
        }
        else {
            rows.push({ evidence, status: 'ADMITTED', codes: [], boundaryExcluded: false });
        }
    }
    const directBundle = buildBundle(context, rows);
    const report = inspectEvidence(directBundle, context.snapshot.asOf, { m1AdmitBoundary: true });
    const available = new Set(report.facts.filter((f) => f.status === 'AVAILABLE').map((f) => f.id));
    const admittedIds = [];
    for (const row of rows) {
        if (row.status !== 'ADMITTED')
            continue;
        if (!available.has(row.evidence.id)) {
            row.status = 'EXCLUDED';
            const state = report.facts.find((f) => f.id === row.evidence.id);
            row.codes = [...new Set([...(state?.reasons ?? ['UNAVAILABLE'])])].sort();
            row.boundaryExcluded = false;
        }
        else {
            admittedIds.push(row.evidence.id);
        }
    }
    admittedIds.sort();
    const admittedRows = rows.filter((r) => r.status === 'ADMITTED');
    const finalBundle = {
        sources: context.snapshot.sources,
        facts: admittedRows.map((r) => toFact(r.evidence, fieldDef(context, r.evidence.field)?.unit)),
    };
    return { rows, admittedIds, directBundle, bundle: finalBundle };
}
