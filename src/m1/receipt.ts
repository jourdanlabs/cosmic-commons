// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { canonicalize, sha256, sha256Bytes } from '../canonical.ts';
import { M1_RECEIPT_CANONICAL_BUDGET } from './validate.ts';
import { executionRuntime } from '../runtime.ts';
import type { ValidatedM1Context } from './validate.ts';
import type { LinkIssue } from './link.ts';
import type { AdmitResult } from './admit.ts';
import type { FactsResult, ItemFieldFact } from './facts.ts';

export interface M1Reason {
  owner: string;
  engine: string;
  code: string;
  question: string;
  itemId: string;
  field?: string;
  evidenceIds: string[];
  dependencyIds: string[];
}

export interface M1ItemResult {
  itemId: string;
  evidenceStatus: 'INCOMPLETE' | 'COMPLETE';
  routingDisposition: 'NEEDS_EVIDENCE' | null;
  finalDecision: null;
  finalDecisionStatus: 'NOT_EVALUATED';
  reasons: M1Reason[];
  facts: ItemFieldFact[];
  traces: { stage: string; status: string; codes: string[] }[];
}

export interface M1Receipt {
  schemaVersion: 'commons.m1-evidence-receipt.v1';
  evaluationScope: 'M1_EVIDENCE_ONLY';
  inputs: { snapshot: unknown; schema: unknown; policy: unknown };
  inputDigest: string;
  schemaDigest: string;
  policyDigest: string;
  artifactIdentity: string;
  runtimeIdentity: string;
  items: M1ItemResult[];
  pendingStages: string[];
  knownRequired: number;
  requiredCount: number;
  digest: string;
}

const PENDING = ['Bound', 'Stress', 'Window', 'Challenge', 'Gate', 'Portfolio'];

function receiptBudget(context: ValidatedM1Context) {
  return context.snapshot.items.length > 512 ? M1_RECEIPT_CANONICAL_BUDGET : undefined;
}

function digestNormalized(value: unknown, budget?: typeof M1_RECEIPT_CANONICAL_BUDGET): string {
  return budget ? sha256Bytes(canonicalize(value, budget)) : sha256(value);
}

export function buildM1Receipt(
  context: ValidatedM1Context,
  linkIssues: LinkIssue[],
  admit: AdmitResult,
  facts: FactsResult,
  tracesByItem: Map<string, M1ItemResult['traces']>,
): M1Receipt {
  const budget = receiptBudget(context);
  const normalizedSnapshot = JSON.parse(canonicalize(context.snapshot, budget));
  const normalizedSchema = JSON.parse(canonicalize(context.schema, budget));
  const normalizedPolicy = JSON.parse(canonicalize(context.policy, budget));
  const inputDigest = digestNormalized(normalizedSnapshot, budget);
  const runtime = executionRuntime();
  const items: M1ItemResult[] = context.snapshot.items.map((item) => {
    const itemFacts = facts.fields.filter((f) => f.itemId === item.id);
    const itemLink = linkIssues.filter((issue) => issue.itemId === item.id);
    const reasons: M1Reason[] = [];

    for (const issue of itemLink) {
      reasons.push({
        owner: issue.owner,
        engine: 'Link',
        code: issue.code,
        question: issue.question,
        itemId: item.id,
        evidenceIds: [],
        dependencyIds: [...issue.dependencyIds].sort(),
      });
    }

    for (const field of itemFacts) {
      const schemaField = context.schema.fields.find((f) => f.name === field.field)!;
      if (field.state === 'CONFLICT') {
        reasons.push({
          owner: schemaField.owner,
          engine: 'Facts',
          code: 'FIELD_CONFLICT',
          question: `Resolve conflicting ${field.field} evidence for ${item.id}.`,
          itemId: item.id,
          field: field.field,
          evidenceIds: field.evidenceIds,
          dependencyIds: [],
        });
      } else if (field.state === 'UNKNOWN' && schemaField.required) {
        reasons.push({
          owner: schemaField.owner,
          engine: 'Facts',
          code: 'MISSING_REQUIRED_FIELD',
          question: `Supply current ${field.field} evidence for ${item.id}.`,
          itemId: item.id,
          field: field.field,
          evidenceIds: [],
          dependencyIds: [],
        });
      }
    }

    for (const row of admit.rows.filter((r) => r.evidence.itemId === item.id && r.status === 'EXCLUDED')) {
      const schemaField = context.schema.fields.find((f) => f.name === row.evidence.field);
      reasons.push({
        owner: schemaField?.owner ?? item.owner,
        engine: 'Admit',
        code: row.codes[0] ?? 'EXCLUDED',
        question: `Replace ${row.evidence.id}: ${row.codes.join(', ')}.`,
        itemId: item.id,
        field: row.evidence.field,
        evidenceIds: [row.evidence.id],
        dependencyIds: [],
      });
    }

    reasons.sort((a, b) => {
      const codeCmp = a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
      if (codeCmp !== 0) return codeCmp;
      const af = a.field ?? '';
      const bf = b.field ?? '';
      return af < bf ? -1 : af > bf ? 1 : 0;
    });

    const hasBlocker =
      itemLink.length > 0 ||
      itemFacts.some((f) => f.state === 'CONFLICT') ||
      itemFacts.some((f) => {
        const sf = context.schema.fields.find((x) => x.name === f.field);
        return sf?.required && f.state === 'UNKNOWN';
      });

    return {
      itemId: item.id,
      evidenceStatus: hasBlocker ? 'INCOMPLETE' : 'COMPLETE',
      routingDisposition: hasBlocker ? 'NEEDS_EVIDENCE' : null,
      finalDecision: null,
      finalDecisionStatus: 'NOT_EVALUATED',
      reasons,
      facts: itemFacts,
      traces: tracesByItem.get(item.id) ?? [],
    };
  });

  const body = {
    schemaVersion: 'commons.m1-evidence-receipt.v1' as const,
    evaluationScope: 'M1_EVIDENCE_ONLY' as const,
    inputs: { snapshot: normalizedSnapshot, schema: normalizedSchema, policy: normalizedPolicy },
    inputDigest,
    schemaDigest: digestNormalized(normalizedSchema, budget),
    policyDigest: digestNormalized(normalizedPolicy, budget),
    artifactIdentity: runtime.sourceDigest,
    runtimeIdentity: canonicalize({
      node: runtime.node,
      v8: runtime.v8,
      platform: runtime.platform,
      architecture: runtime.architecture,
      endianness: runtime.endianness,
      sourceDigest: runtime.sourceDigest,
      codeDigest: runtime.codeDigest,
    }),
    items,
    pendingStages: PENDING,
    knownRequired: facts.knownRequired,
    requiredCount: facts.requiredCount,
  };
  const digest = sha256Bytes(canonicalize(body, budget ?? M1_RECEIPT_CANONICAL_BUDGET));
  return { ...body, digest };
}
