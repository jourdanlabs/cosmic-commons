// Independent reference: fixed-width UTC lexical interval checks (T01).
export function lexicalTimeboxStatus(observedAt: string, expiresAt: string, asOf: string): 'FUTURE' | 'CURRENT' | 'EXPIRED' {
  if (asOf < observedAt) return 'FUTURE';
  if (asOf >= expiresAt) return 'EXPIRED';
  return 'CURRENT';
}
