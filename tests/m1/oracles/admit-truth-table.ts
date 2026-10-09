// A01 independent reference: exhaustive subject × issuer × time admissibility (no production admit import).

export type TimeStatus = 'CURRENT' | 'EXPIRED' | 'FUTURE';

export function expectedDirectAdmissible(input: {
  subjectMatches: boolean;
  issuerAuthorized: boolean;
  timeStatus: TimeStatus;
}): boolean {
  if (!input.subjectMatches) return false;
  if (!input.issuerAuthorized) return false;
  if (input.timeStatus !== 'CURRENT') return false;
  return true;
}
