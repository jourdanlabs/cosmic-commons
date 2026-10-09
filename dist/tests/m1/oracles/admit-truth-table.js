// A01 independent reference: exhaustive subject × issuer × time admissibility (no production admit import).
export function expectedDirectAdmissible(input) {
    if (!input.subjectMatches)
        return false;
    if (!input.issuerAuthorized)
        return false;
    if (input.timeStatus !== 'CURRENT')
        return false;
    return true;
}
