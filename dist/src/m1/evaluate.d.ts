import { type ValidatedM1Context } from './validate.ts';
import { type M1Receipt } from './receipt.ts';
export type M1EvaluationResult = {
    ok: true;
    receipt: M1Receipt;
    context: ValidatedM1Context;
} | {
    ok: false;
    code: string;
    path: string;
    message: string;
};
export declare function evaluateEvidence(snapshotText: string, schemaText: string, policyText: string): M1EvaluationResult;
export { evaluateValidate as evaluateValidateStage } from './validate.ts';
export declare function evaluateLinkStage(snapshotText: string, schemaText: string, policyText: string): import("./link.ts").LinkResult;
export declare function evaluateTimeboxStage(snapshotText: string, schemaText: string, policyText: string): {
    id: string;
    status: import("./timebox.ts").TimeboxStatus;
}[];
export declare function evaluateAdmitStage(snapshotText: string, schemaText: string, policyText: string): import("./admit.ts").AdmitResult;
export declare function evaluateFactsStage(snapshotText: string, schemaText: string, policyText: string): import("./facts.ts").FactsResult;
