export type OracleFactState = 'KNOWN' | 'UNKNOWN' | 'CONFLICT';
export declare function expectedFieldState(admittedValues: {
    value: unknown;
    type: string;
}[]): {
    state: OracleFactState;
    value?: unknown;
};
