// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { inspectEvidence } from '../evidence.ts';
import type { EvidenceBundle, EvidenceFact } from '../evidence.ts';
import type { JsonValue } from '../canonical.ts';
import { fieldClaimKey } from './claim-key.ts';
import { classifyInterval } from './timebox.ts';
import type { ValidatedM1Context, SnapshotEvidence } from './validate.ts';
import { assertTypedFieldValue } from './typed-value.ts';

export type AdmitExclusionCode = 'WRONG_SUBJECT' | 'UNAUTHORIZED_ISSUER' | 'EXPIRED' | 'FUTURE' | string;

export interface AdmitRow {
  evidence: SnapshotEvidence;
  status: 'ADMITTED' | 'EXCLUDED';
  codes: AdmitExclusionCode[];
  /** Excluded at the M1 boundary before core inspection (issuer/subject/time/type). */
  boundaryExcluded: boolean;
}

export interface AdmitResult {
  rows: AdmitRow[];
  admittedIds: string[];
  directBundle: EvidenceBundle;
  bundle: EvidenceBundle;
}

function fieldDef(context: ValidatedM1Context, name: string) {
  return context.schema.fields.find((f) => f.name === name);
}

function toFact(row: SnapshotEvidence, unit?: string, admissionExcluded?: string[]): EvidenceFact {
  return {
    id: row.id,
    sourceId: row.sourceId,
    value: row.value as JsonValue,
    claimId: fieldClaimKey(row.itemId, row.field),
    ...(unit ? { unit } : {}),
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    dependsOn: row.dependsOn,
    ...(admissionExcluded?.length ? { admissionExcluded: [...admissionExcluded].sort() } : {}),
  };
}

function buildBundle(context: ValidatedM1Context, rows: AdmitRow[]): EvidenceBundle {
  return {
    sources: context.snapshot.sources,
    facts: context.snapshot.evidence.map((evidence) => {
      const row = rows.find((r) => r.evidence.id === evidence.id)!;
      const field = fieldDef(context, evidence.field);
      const codes = row.status === 'EXCLUDED' && row.boundaryExcluded ? row.codes : undefined;
      return toFact(evidence, field?.unit, codes);
    }),
  };
}

export function evaluateAdmit(context: ValidatedM1Context): AdmitResult {
  const rows: AdmitRow[] = [];

  for (const evidence of context.snapshot.evidence) {
    const codes: AdmitExclusionCode[] = [];
    const field = fieldDef(context, evidence.field);
    if (!field) {
      codes.push('UNKNOWN_FIELD');
    } else {
      assertTypedFieldValue(evidence.value, field.type, `snapshot.evidence.${evidence.id}.value`);
      if (evidence.subjectId !== evidence.itemId) codes.push('WRONG_SUBJECT');
      if (!field.issuerAuthorities.includes(evidence.issuer)) codes.push('UNAUTHORIZED_ISSUER');
      const time = classifyInterval(evidence.observedAt, evidence.expiresAt, context.snapshot.asOf);
      if (time === 'EXPIRED') codes.push('EXPIRED');
      if (time === 'FUTURE') codes.push('FUTURE');
    }
    if (codes.length) {
      rows.push({ evidence, status: 'EXCLUDED', codes: [...new Set(codes)].sort(), boundaryExcluded: true });
    } else {
      rows.push({ evidence, status: 'ADMITTED', codes: [], boundaryExcluded: false });
    }
  }

  const directBundle = buildBundle(context, rows);
  const report = inspectEvidence(directBundle, context.snapshot.asOf, { m1AdmitBoundary: true });
  const available = new Set(report.facts.filter((f) => f.status === 'AVAILABLE').map((f) => f.id));

  const admittedIds: string[] = [];
  for (const row of rows) {
    if (row.status !== 'ADMITTED') continue;
    if (!available.has(row.evidence.id)) {
      row.status = 'EXCLUDED';
      const state = report.facts.find((f) => f.id === row.evidence.id);
      row.codes = [...new Set([...(state?.reasons ?? ['UNAVAILABLE'])])].sort();
      row.boundaryExcluded = false;
    } else {
      admittedIds.push(row.evidence.id);
    }
  }
  admittedIds.sort();

  const admittedRows = rows.filter((r) => r.status === 'ADMITTED');
  const finalBundle: EvidenceBundle = {
    sources: context.snapshot.sources,
    facts: admittedRows.map((r) => toFact(r.evidence, fieldDef(context, r.evidence.field)?.unit)),
  };

  return { rows, admittedIds, directBundle, bundle: finalBundle };
}
