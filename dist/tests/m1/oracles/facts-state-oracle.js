// F01 independent reference: multiset partition by structural fingerprint (not production typedValueIdentity).
function fingerprint(value, type) {
    if (type === 'integer-range' && value && typeof value === 'object' && !Array.isArray(value)) {
        const range = value;
        return `range|${String(range.low)}|${String(range.high)}`;
    }
    if (type === 'boolean')
        return value === true ? 'bool|T' : value === false ? 'bool|F' : 'bool|?';
    if (type === 'integer' && typeof value === 'number')
        return `int|${value}`;
    if (type === 'nonempty-string' && typeof value === 'string')
        return `str|${value.split('').map((c) => c.codePointAt(0).toString(16)).join('.')}`;
    return `other|${type}|${String(value)}`;
}
export function expectedFieldState(admittedValues) {
    if (!admittedValues.length)
        return { state: 'UNKNOWN' };
    const fingerprints = admittedValues.map((v) => fingerprint(v.value, v.type));
    const unique = new Set(fingerprints);
    if (unique.size === 1)
        return { state: 'KNOWN', value: admittedValues[0].value };
    return { state: 'CONFLICT' };
}
