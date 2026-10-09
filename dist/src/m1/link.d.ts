import type { ValidatedM1Context } from './validate.ts';
export interface LinkIssue {
    code: 'MISSING_DEPENDENCY' | 'DEPENDENCY_CYCLE';
    itemId: string;
    owner: string;
    dependencyIds: string[];
    question: string;
}
export interface LinkResult {
    issues: LinkIssue[];
}
export declare function evaluateLink(context: ValidatedM1Context): LinkResult;
