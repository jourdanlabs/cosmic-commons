import type { EvidenceBundle } from '../evidence.ts';
import type { ValidatedM1Context, SnapshotEvidence } from './validate.ts';
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
export declare function evaluateAdmit(context: ValidatedM1Context): AdmitResult;
