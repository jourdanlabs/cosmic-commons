import type { AdmitResult } from './admit.ts';
import type { ValidatedM1Context } from './validate.ts';
export type FieldFactState = 'KNOWN' | 'UNKNOWN' | 'CONFLICT';
export interface ItemFieldFact {
    itemId: string;
    field: string;
    state: FieldFactState;
    value?: unknown;
    evidenceIds: string[];
    valueGroups?: {
        canonical: string;
        evidenceIds: string[];
    }[];
}
export interface FactsResult {
    fields: ItemFieldFact[];
    knownRequired: number;
    requiredCount: number;
}
export declare function evaluateFacts(context: ValidatedM1Context, admit: AdmitResult): FactsResult;
