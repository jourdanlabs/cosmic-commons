// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { parseStrictJson } from '../strict-json.ts';
import { canonicalize, timestamp } from '../canonical.ts';
import { EVIDENCE_LIMITS, exactKeys, requiredId } from '../evidence.ts';
import type { EvidenceSource } from '../evidence.ts';
import { invalidInput } from './errors.ts';

const SNAPSHOT_KEYS = ['schemaVersion', 'asOf', 'items', 'sources', 'evidence'] as const;
const ITEM_KEYS = ['id', 'priority', 'owner', 'dependsOn'] as const;
const EVIDENCE_KEYS = ['id', 'itemId', 'subjectId', 'field', 'issuer', 'sourceId', 'observedAt', 'expiresAt', 'value', 'dependsOn'] as const;
const FIELD_KEYS = ['name', 'type', 'issuerAuthorities', 'required', 'eligibility', 'disqualifier', 'owner', 'unit'] as const;
const POLICY_KEYS = ['schemaVersion', 'id', 'version', 'priorityOrder'] as const;
const SOURCE_KEYS = ['id', 'uri', 'content', 'digest'] as const;

export type FieldType = 'boolean' | 'integer' | 'nonempty-string' | 'integer-range';

export interface SnapshotEvidence {
  id: string;
  itemId: string;
  subjectId: string;
  field: string;
  issuer: string;
  sourceId: string;
  observedAt: string;
  expiresAt: string;
  value: unknown;
  dependsOn: string[];
}

export interface NormalizedSnapshot {
  schemaVersion: 'commons.evidence-snapshot.v1';
  asOf: string;
  items: { id: string; priority: number; owner: string; dependsOn: string[] }[];
  sources: EvidenceSource[];
  evidence: SnapshotEvidence[];
}

export interface NormalizedFieldSchema {
  schemaVersion: 'commons.field-schema.v1';
  id: string;
  version: string;
  fields: {
    name: string;
    type: FieldType;
    issuerAuthorities: string[];
    required: boolean;
    eligibility: boolean;
    disqualifier: boolean;
    owner: string;
    unit?: string;
  }[];
}

export interface NormalizedM1Policy {
  schemaVersion: 'commons.m1-policy.v1';
  id: string;
  version: string;
  priorityOrder: 'ascending' | 'descending';
}

/** Declared M1 ceiling for item graph size (distinct from core evidence limits). */
export const M1_ITEM_LIMIT = 20_000;
/** Full M1 evidence receipts (with replayable inputs and per-item traces). */
export const M1_RECEIPT_ITEM_LIMIT = 1024;
export const M1_RECEIPT_TRACE_LIMIT = 512;
/** Canonical budget for M1 evidence receipts (large item graphs, compact cycle refs). */
export const M1_RECEIPT_CANONICAL_BUDGET = { maxNodes: 1_000_000, maxBytes: 24_000_000 } as const;

export interface ValidatedM1Context {
  snapshot: NormalizedSnapshot;
  schema: NormalizedFieldSchema;
  policy: NormalizedM1Policy;
  snapshotText: string;
  schemaText: string;
  policyText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireUtcMillisForm(value: string, path: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    invalidInput('INVALID_TIMESTAMP', path, 'Timestamp must be YYYY-MM-DDTHH:mm:ss.sssZ');
  }
  timestamp(value, path);
}

function sortUniqueStrings(values: string[], path: string): string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) invalidInput('DUPLICATE_REFERENCE', path, 'Duplicate entries in sorted list');
  return sorted;
}

function validateSource(source: unknown, path: string): EvidenceSource {
  if (!isRecord(source)) invalidInput('INVALID_INPUT', path, 'Source must be an object');
  exactKeys(source, SOURCE_KEYS, 'source');
  requiredId(source.id, `${path}.id`);
  const out: EvidenceSource = { id: source.id };
  if ('uri' in source) {
    if (typeof source.uri !== 'string' || !source.uri.trim()) invalidInput('INVALID_INPUT', `${path}.uri`, 'uri must be nonempty');
    out.uri = source.uri;
  }
  if ('content' in source) out.content = source.content as EvidenceSource['content'];
  if ('digest' in source) {
    if (typeof source.digest !== 'string' || !/^[0-9a-f]{64}$/.test(source.digest)) {
      invalidInput('INVALID_INPUT', `${path}.digest`, 'digest must be lowercase sha256 hex');
    }
    out.digest = source.digest;
  }
  return out;
}

function parseSnapshot(raw: string): NormalizedSnapshot {
  const value = parseStrictJson(raw);
  if (!isRecord(value)) invalidInput('INVALID_INPUT', 'snapshot', 'Snapshot must be an object');
  exactKeys(value, SNAPSHOT_KEYS, 'snapshot');
  if (value.schemaVersion !== 'commons.evidence-snapshot.v1') invalidInput('INVALID_INPUT', 'snapshot.schemaVersion', 'Unsupported snapshot schemaVersion');
  if (typeof value.asOf !== 'string') invalidInput('INVALID_INPUT', 'snapshot.asOf', 'asOf must be a string');
  requireUtcMillisForm(value.asOf, 'snapshot.asOf');
  if (!Array.isArray(value.items) || !Array.isArray(value.sources) || !Array.isArray(value.evidence)) {
    invalidInput('INVALID_INPUT', 'snapshot', 'items, sources and evidence must be arrays');
  }
  const items = value.items.map((item, index) => {
    if (!isRecord(item)) invalidInput('INVALID_INPUT', `snapshot.items[${index}]`, 'Item must be an object');
    exactKeys(item, ITEM_KEYS, 'item');
    requiredId(item.id, 'item.id');
    requiredId(item.owner, 'item.owner');
    if (typeof item.priority !== 'number' || !Number.isSafeInteger(item.priority)) {
      invalidInput('INVALID_INPUT', `snapshot.items[${index}].priority`, 'priority must be a safe integer');
    }
    if (!Array.isArray(item.dependsOn)) invalidInput('INVALID_INPUT', `snapshot.items[${index}].dependsOn`, 'dependsOn must be an array');
    for (const dep of item.dependsOn) requiredId(dep, 'item.dependsOn entry');
    return {
      id: item.id,
      priority: item.priority,
      owner: item.owner,
      dependsOn: sortUniqueStrings(item.dependsOn as string[], `snapshot.items[${index}].dependsOn`),
    };
  });
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) invalidInput('DUPLICATE_ID', 'snapshot.items', `Duplicate item id: ${item.id}`);
    itemIds.add(item.id);
  }
  if (items.length > M1_ITEM_LIMIT) {
    invalidInput('JSON_LIMIT', 'snapshot.items', `At most ${M1_ITEM_LIMIT} items in M1`);
  }
  const sources = value.sources.map((source, index) => validateSource(source, `snapshot.sources[${index}]`));
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) invalidInput('DUPLICATE_ID', 'snapshot.sources', `Duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
  }
  sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const evidenceIds = new Set<string>();
  const evidence = value.evidence.map((row, index) => {
    if (!isRecord(row)) invalidInput('INVALID_INPUT', `snapshot.evidence[${index}]`, 'Evidence must be an object');
    exactKeys(row, EVIDENCE_KEYS, 'evidence');
    requiredId(row.id, 'evidence.id');
    if (evidenceIds.has(row.id)) invalidInput('DUPLICATE_ID', 'snapshot.evidence', `Duplicate evidence id: ${row.id}`);
    evidenceIds.add(row.id);
    requiredId(row.itemId, 'evidence.itemId');
    requiredId(row.subjectId, 'evidence.subjectId');
    requiredId(row.field, 'evidence.field');
    requiredId(row.issuer, 'evidence.issuer');
    requiredId(row.sourceId, 'evidence.sourceId');
    if (!itemIds.has(row.itemId as string)) invalidInput('INVALID_INPUT', `snapshot.evidence[${index}].itemId`, 'Unknown itemId');
    if (!sourceIds.has(row.sourceId as string)) invalidInput('INVALID_INPUT', `snapshot.evidence[${index}].sourceId`, 'Unknown sourceId');
    requireUtcMillisForm(String(row.observedAt), `snapshot.evidence[${index}].observedAt`);
    requireUtcMillisForm(String(row.expiresAt), `snapshot.evidence[${index}].expiresAt`);
    if (timestamp(row.expiresAt) <= timestamp(row.observedAt)) {
      invalidInput('INVALID_RANGE', `snapshot.evidence[${index}]`, 'expiresAt must follow observedAt');
    }
    if (!Array.isArray(row.dependsOn)) invalidInput('INVALID_INPUT', `snapshot.evidence[${index}].dependsOn`, 'dependsOn must be an array');
    for (const dep of row.dependsOn) requiredId(dep, 'evidence.dependsOn entry');
    if (!Object.hasOwn(row, 'value')) invalidInput('INVALID_INPUT', `snapshot.evidence[${index}].value`, 'value is required');
    return {
      id: row.id as string,
      itemId: row.itemId as string,
      subjectId: row.subjectId as string,
      field: row.field as string,
      issuer: row.issuer as string,
      sourceId: row.sourceId as string,
      observedAt: String(row.observedAt),
      expiresAt: String(row.expiresAt),
      value: row.value,
      dependsOn: sortUniqueStrings(row.dependsOn as string[], `snapshot.evidence[${index}].dependsOn`),
    };
  });
  evidence.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (sources.length > EVIDENCE_LIMITS.sources) {
    invalidInput('EVIDENCE_LIMIT', 'snapshot.sources', `At most ${EVIDENCE_LIMITS.sources} sources`);
  }
  if (evidence.length > EVIDENCE_LIMITS.facts) {
    invalidInput('EVIDENCE_LIMIT', 'snapshot.evidence', `At most ${EVIDENCE_LIMITS.facts} evidence rows`);
  }
  let evidenceDependencyRefs = 0;
  for (const row of evidence) evidenceDependencyRefs += row.dependsOn.length;
  if (evidenceDependencyRefs > EVIDENCE_LIMITS.dependencies) {
    invalidInput('EVIDENCE_LIMIT', 'snapshot', `At most ${EVIDENCE_LIMITS.dependencies} evidence dependency references`);
  }
  let itemDependencyRefs = 0;
  for (const item of items) itemDependencyRefs += item.dependsOn.length;
  if (itemDependencyRefs > M1_ITEM_LIMIT) {
    invalidInput('JSON_LIMIT', 'snapshot.items', `At most ${M1_ITEM_LIMIT} item dependency references`);
  }
  canonicalize({ sources, evidence });
  return { schemaVersion: 'commons.evidence-snapshot.v1', asOf: value.asOf, items, sources, evidence };
}

function parseSchema(raw: string): NormalizedFieldSchema {
  const value = parseStrictJson(raw);
  if (!isRecord(value)) invalidInput('INVALID_INPUT', 'schema', 'Schema must be an object');
  exactKeys(value, ['schemaVersion', 'id', 'version', 'fields'], 'schema');
  if (value.schemaVersion !== 'commons.field-schema.v1') invalidInput('INVALID_INPUT', 'schema.schemaVersion', 'Unsupported field schema');
  requiredId(value.id, 'schema.id');
  requiredId(value.version, 'schema.version');
  if (!Array.isArray(value.fields)) invalidInput('INVALID_INPUT', 'schema.fields', 'fields must be an array');
  const fields = value.fields.map((field, index) => {
    if (!isRecord(field)) invalidInput('INVALID_INPUT', `schema.fields[${index}]`, 'Field must be an object');
    exactKeys(field, FIELD_KEYS, 'field');
    requiredId(field.name, 'field.name');
    requiredId(field.owner, 'field.owner');
    const type = field.type;
    if (type !== 'boolean' && type !== 'integer' && type !== 'nonempty-string' && type !== 'integer-range') {
      invalidInput('INVALID_INPUT', `schema.fields[${index}].type`, 'Unsupported field type');
    }
    if (typeof field.required !== 'boolean' || typeof field.eligibility !== 'boolean' || typeof field.disqualifier !== 'boolean') {
      invalidInput('INVALID_INPUT', `schema.fields[${index}]`, 'required, eligibility and disqualifier must be boolean');
    }
    if (field.eligibility && !field.required) invalidInput('INVALID_INPUT', `schema.fields[${index}]`, 'eligibility fields must be required');
    if (!Array.isArray(field.issuerAuthorities)) invalidInput('INVALID_INPUT', `schema.fields[${index}].issuerAuthorities`, 'issuerAuthorities must be an array');
    for (const auth of field.issuerAuthorities) requiredId(auth, 'issuerAuthorities entry');
    if ('unit' in field) requiredId(field.unit, 'field.unit');
    return {
      name: field.name as string,
      type: type as FieldType,
      issuerAuthorities: sortUniqueStrings(field.issuerAuthorities as string[], `schema.fields[${index}].issuerAuthorities`),
      required: field.required,
      eligibility: field.eligibility,
      disqualifier: field.disqualifier,
      owner: field.owner as string,
      ...(field.unit !== undefined ? { unit: field.unit as string } : {}),
    };
  });
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) invalidInput('DUPLICATE_ID', 'schema.fields', `Duplicate field name: ${field.name}`);
    names.add(field.name);
  }
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { schemaVersion: 'commons.field-schema.v1', id: value.id as string, version: value.version as string, fields };
}

function parsePolicy(raw: string): NormalizedM1Policy {
  const value = parseStrictJson(raw);
  if (!isRecord(value)) invalidInput('INVALID_INPUT', 'policy', 'Policy must be an object');
  exactKeys(value, POLICY_KEYS, 'policy');
  if (value.schemaVersion !== 'commons.m1-policy.v1') invalidInput('INVALID_INPUT', 'policy.schemaVersion', 'Unsupported M1 policy schema');
  requiredId(value.id, 'policy.id');
  requiredId(value.version, 'policy.version');
  if (value.priorityOrder !== 'ascending' && value.priorityOrder !== 'descending') {
    invalidInput('INVALID_INPUT', 'policy.priorityOrder', 'priorityOrder must be ascending or descending');
  }
  return {
    schemaVersion: 'commons.m1-policy.v1',
    id: value.id as string,
    version: value.version as string,
    priorityOrder: value.priorityOrder as 'ascending' | 'descending',
  };
}

export function sortItems(context: ValidatedM1Context): ValidatedM1Context {
  const sign = context.policy.priorityOrder === 'ascending' ? 1 : -1;
  const items = [...context.snapshot.items].sort((a, b) => {
    if (a.priority === b.priority) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return (a.priority - b.priority) * sign;
  });
  return { ...context, snapshot: { ...context.snapshot, items } };
}

export function validateM1Inputs(snapshotText: string, schemaText: string, policyText: string): ValidatedM1Context {
  const context: ValidatedM1Context = {
    snapshot: parseSnapshot(snapshotText),
    schema: parseSchema(schemaText),
    policy: parsePolicy(policyText),
    snapshotText,
    schemaText,
    policyText,
  };
  return sortItems(context);
}

export function evaluateValidate(snapshotText: string, schemaText: string, policyText: string): ValidatedM1Context {
  return validateM1Inputs(snapshotText, schemaText, policyText);
}
