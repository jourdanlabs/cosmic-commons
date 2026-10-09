export type TimeboxStatus = 'FUTURE' | 'CURRENT' | 'EXPIRED';
/** Half-open current interval: observedAt <= asOf < expiresAt (SC / PRD Timebox). */
export declare function classifyInterval(observedAt: string, expiresAt: string, asOf: string): TimeboxStatus;
export declare function evaluateTimebox(evidence: {
    id: string;
    observedAt: string;
    expiresAt: string;
}[], asOf: string): {
    id: string;
    status: TimeboxStatus;
}[];
