// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { inspectEvidence } from "../evidence.js";
import { fieldClaimKey } from "./claim-key.js";
import { typedValueIdentity } from "./typed-value.js";
export function evaluateFacts(context, admit) {
    const report = inspectEvidence(admit.directBundle, context.snapshot.asOf, { m1AdmitBoundary: true });
    const statusById = new Map(report.facts.map((f) => [f.id, f.status]));
    const fields = [];
    let knownRequired = 0;
    let requiredCount = 0;
    for (const item of context.snapshot.items) {
        for (const field of context.schema.fields) {
            if (field.required)
                requiredCount++;
            const claim = fieldClaimKey(item.id, field.name);
            const rows = admit.directBundle.facts.filter((f) => f.claimId === claim);
            const evidenceIds = rows.map((r) => r.id).sort();
            if (!rows.length) {
                fields.push({ itemId: item.id, field: field.name, state: 'UNKNOWN', evidenceIds: [] });
                continue;
            }
            const available = rows.filter((r) => statusById.get(r.id) === 'AVAILABLE');
            if (available.length) {
                const groups = new Set(available.map((f) => typedValueIdentity(f.value, field.type)));
                if (groups.size === 1) {
                    fields.push({
                        itemId: item.id,
                        field: field.name,
                        state: 'KNOWN',
                        value: available[0].value,
                        evidenceIds: available.map((r) => r.id).sort(),
                    });
                    if (field.required)
                        knownRequired++;
                }
                else {
                    fields.push({ itemId: item.id, field: field.name, state: 'CONFLICT', evidenceIds });
                }
                continue;
            }
            const statuses = rows.map((r) => statusById.get(r.id) ?? 'MISSING');
            if (statuses.some((s) => s === 'CONFLICT')) {
                const groups = new Map();
                for (const fact of rows) {
                    const key = typedValueIdentity(fact.value, field.type);
                    const ids = groups.get(key) ?? [];
                    ids.push(fact.id);
                    groups.set(key, ids);
                }
                if (groups.size <= 1) {
                    fields.push({ itemId: item.id, field: field.name, state: 'UNKNOWN', evidenceIds });
                    continue;
                }
                const valueGroups = [...groups.entries()].map(([canonical, ids]) => ({ canonical, evidenceIds: [...ids].sort() }));
                valueGroups.sort((a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0));
                fields.push({ itemId: item.id, field: field.name, state: 'CONFLICT', evidenceIds, valueGroups });
                continue;
            }
            fields.push({ itemId: item.id, field: field.name, state: 'UNKNOWN', evidenceIds });
        }
    }
    fields.sort((a, b) => (a.itemId === b.itemId ? (a.field < b.field ? -1 : a.field > b.field ? 1 : 0) : a.itemId < b.itemId ? -1 : 1));
    return { fields, knownRequired, requiredCount };
}
