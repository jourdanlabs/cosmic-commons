// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { timestamp } from "../canonical.js";
/** Half-open current interval: observedAt <= asOf < expiresAt (SC / PRD Timebox). */
export function classifyInterval(observedAt, expiresAt, asOf) {
    const now = timestamp(asOf, 'asOf');
    const start = timestamp(observedAt, 'observedAt');
    const end = timestamp(expiresAt, 'expiresAt');
    if (now < start)
        return 'FUTURE';
    if (now >= end)
        return 'EXPIRED';
    return 'CURRENT';
}
export function evaluateTimebox(evidence, asOf) {
    return evidence.map((row) => ({ id: row.id, status: classifyInterval(row.observedAt, row.expiresAt, asOf) }));
}
