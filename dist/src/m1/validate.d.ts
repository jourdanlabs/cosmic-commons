import type { EvidenceSource } from '../evidence.ts';
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
    items: {
        id: string;
        priority: number;
        owner: string;
        dependsOn: string[];
    }[];
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
export declare const M1_ITEM_LIMIT = 20000;
/** Full M1 evidence receipts (with replayable inputs and per-item traces). */
export declare const M1_RECEIPT_ITEM_LIMIT = 1024;
export declare const M1_RECEIPT_TRACE_LIMIT = 512;
/** Canonical budget for M1 evidence receipts (large item graphs, compact cycle refs). */
export declare const M1_RECEIPT_CANONICAL_BUDGET: {
    readonly maxNodes: 1000000;
    readonly maxBytes: 24000000;
};
export interface ValidatedM1Context {
    snapshot: NormalizedSnapshot;
    schema: NormalizedFieldSchema;
    policy: NormalizedM1Policy;
    snapshotText: string;
    schemaText: string;
    policyText: string;
}
export declare function sortItems(context: ValidatedM1Context): ValidatedM1Context;
export declare function validateM1Inputs(snapshotText: string, schemaText: string, policyText: string): ValidatedM1Context;
export declare function evaluateValidate(snapshotText: string, schemaText: string, policyText: string): ValidatedM1Context;
