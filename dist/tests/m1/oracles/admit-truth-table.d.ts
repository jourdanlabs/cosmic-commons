export type TimeStatus = 'CURRENT' | 'EXPIRED' | 'FUTURE';
export declare function expectedDirectAdmissible(input: {
    subjectMatches: boolean;
    issuerAuthorized: boolean;
    timeStatus: TimeStatus;
}): boolean;
