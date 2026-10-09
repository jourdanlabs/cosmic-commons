// Independent reference: fixed-width UTC lexical interval checks (T01).
export function lexicalTimeboxStatus(observedAt, expiresAt, asOf) {
    if (asOf < observedAt)
        return 'FUTURE';
    if (asOf >= expiresAt)
        return 'EXPIRED';
    return 'CURRENT';
}
