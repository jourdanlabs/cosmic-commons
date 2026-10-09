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
    traces: {
        stage: string;
        status: string;
        codes: string[];
    }[];
}
export interface M1Receipt {
    schemaVersion: 'commons.m1-evidence-receipt.v1';
    evaluationScope: 'M1_EVIDENCE_ONLY';
    inputs: {
        snapshot: unknown;
        schema: unknown;
        policy: unknown;
    };
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
export declare function buildM1Receipt(context: ValidatedM1Context, linkIssues: LinkIssue[], admit: AdmitResult, facts: FactsResult, tracesByItem: Map<string, M1ItemResult['traces']>): M1Receipt;
