export type M1ReplayResult = {
    valid: boolean;
    integrity: 'VALID' | 'INVALID';
    replay: 'MATCH' | 'MISMATCH' | 'UNSUPPORTED';
    anchoring: 'MATCH' | 'MISMATCH' | 'UNANCHORED';
    issues: string[];
    /** Self-consistency under recomputation; not authentication or origin. */
    authenticity: 'NOT_ESTABLISHED';
};
/** Recomputes M1 evidence; optional trustedInputDigest anchors the recorded inputDigest only. */
export declare function verifyM1ReceiptText(raw: string, trustedInputDigest?: string): M1ReplayResult;
