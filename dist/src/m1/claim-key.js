// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
/** Collision-safe item/field identity (not naive string concat). */
const SEP = '\u001f';
export function fieldClaimKey(itemId, fieldName) {
    if (itemId.includes(SEP) || fieldName.includes(SEP)) {
        throw new TypeError('itemId and fieldName may not contain the unit separator');
    }
    return `${itemId}${SEP}${fieldName}`;
}
export function parseFieldClaimKey(key) {
    const index = key.indexOf(SEP);
    if (index <= 0 || index === key.length - 1)
        throw new TypeError('Invalid field claim key');
    return { itemId: key.slice(0, index), fieldName: key.slice(index + 1) };
}
