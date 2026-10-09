// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { canonicalize, sha256Bytes } from "../canonical.js";
import { M1_RECEIPT_CANONICAL_BUDGET } from "./validate.js";
import { parseStrictJson } from "../strict-json.js";
import { executionRuntime } from "../runtime.js";
import { evaluateEvidence } from "./evaluate.js";
function runtimeIdentity() {
    const runtime = executionRuntime();
    return canonicalize({
        node: runtime.node,
        v8: runtime.v8,
        platform: runtime.platform,
        architecture: runtime.architecture,
        endianness: runtime.endianness,
        sourceDigest: runtime.sourceDigest,
        codeDigest: runtime.codeDigest,
    });
}
/** Recomputes M1 evidence; optional trustedInputDigest anchors the recorded inputDigest only. */
export function verifyM1ReceiptText(raw, trustedInputDigest) {
    const result = {
        valid: false,
        integrity: 'INVALID',
        replay: 'UNSUPPORTED',
        anchoring: trustedInputDigest === undefined ? 'UNANCHORED' : 'MISMATCH',
        issues: [],
        authenticity: 'NOT_ESTABLISHED',
    };
    try {
        if (trustedInputDigest !== undefined && (typeof trustedInputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(trustedInputDigest))) {
            result.issues.push('TRUSTED_INPUT_DIGEST_INVALID');
            return result;
        }
        const receipt = parseStrictJson(raw);
        const { digest, ...body } = receipt;
        const computedDigest = sha256Bytes(canonicalize(body, M1_RECEIPT_CANONICAL_BUDGET));
        result.integrity = computedDigest === digest ? 'VALID' : 'INVALID';
        if (result.integrity === 'INVALID')
            result.issues.push('DIGEST_MISMATCH');
        if (trustedInputDigest !== undefined) {
            result.anchoring =
                receipt.inputDigest === trustedInputDigest && computedDigest === digest ? 'MATCH' : 'MISMATCH';
            if (result.anchoring === 'MISMATCH')
                result.issues.push('TRUSTED_INPUT_DIGEST_MISMATCH');
        }
        else {
            result.anchoring = 'UNANCHORED';
        }
        if (receipt.runtimeIdentity !== runtimeIdentity()) {
            result.issues.push('UNSUPPORTED_ENVIRONMENT');
            return result;
        }
        const snapshotText = canonicalize(receipt.inputs.snapshot);
        const schemaText = canonicalize(receipt.inputs.schema);
        const policyText = canonicalize(receipt.inputs.policy);
        const replayed = evaluateEvidence(snapshotText, schemaText, policyText);
        if (!replayed.ok) {
            result.replay = 'MISMATCH';
            result.issues.push('RECOMPUTE_FAILED');
            return result;
        }
        const replayBody = { ...replayed.receipt };
        delete replayBody.digest;
        const originalBody = { ...body };
        result.replay = canonicalize(replayBody) === canonicalize(originalBody) ? 'MATCH' : 'MISMATCH';
        if (result.replay === 'MISMATCH')
            result.issues.push('REPLAY_MISMATCH');
        result.valid = result.integrity === 'VALID' && result.replay === 'MATCH' && result.anchoring !== 'MISMATCH';
        if (result.valid && result.anchoring === 'UNANCHORED') {
            result.issues.push('UNANCHORED_SELF_CONSISTENCY_ONLY');
        }
    }
    catch (error) {
        result.issues.push(error instanceof Error ? error.message : String(error));
    }
    return result;
}
