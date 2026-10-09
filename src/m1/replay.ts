// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import { canonicalize, sha256, sha256Bytes } from '../canonical.ts';
import { M1_RECEIPT_CANONICAL_BUDGET } from './validate.ts';
import { parseStrictJson } from '../strict-json.ts';
import { executionRuntime } from '../runtime.ts';
import { evaluateEvidence } from './evaluate.ts';
import type { M1Receipt } from './receipt.ts';

export type M1ReplayResult = {
  valid: boolean;
  integrity: 'VALID' | 'INVALID';
  replay: 'MATCH' | 'MISMATCH' | 'UNSUPPORTED';
  anchoring: 'MATCH' | 'MISMATCH' | 'UNANCHORED';
  issues: string[];
  /** Self-consistency under recomputation; not authentication or origin. */
  authenticity: 'NOT_ESTABLISHED';
};

function runtimeIdentity(): string {
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
export function verifyM1ReceiptText(raw: string, trustedInputDigest?: string): M1ReplayResult {
  const result: M1ReplayResult = {
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
    const receipt = parseStrictJson(raw) as M1Receipt & { digest: string };
    const { digest, ...body } = receipt;
    const computedDigest = sha256Bytes(canonicalize(body, M1_RECEIPT_CANONICAL_BUDGET));
    result.integrity = computedDigest === digest ? 'VALID' : 'INVALID';
    if (result.integrity === 'INVALID') result.issues.push('DIGEST_MISMATCH');

    if (trustedInputDigest !== undefined) {
      result.anchoring =
        receipt.inputDigest === trustedInputDigest && computedDigest === digest ? 'MATCH' : 'MISMATCH';
      if (result.anchoring === 'MISMATCH') result.issues.push('TRUSTED_INPUT_DIGEST_MISMATCH');
    } else {
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
    delete (replayBody as { digest?: string }).digest;
    const originalBody = { ...body };
    result.replay = canonicalize(replayBody) === canonicalize(originalBody) ? 'MATCH' : 'MISMATCH';
    if (result.replay === 'MISMATCH') result.issues.push('REPLAY_MISMATCH');
    result.valid = result.integrity === 'VALID' && result.replay === 'MATCH' && result.anchoring !== 'MISMATCH';
    if (result.valid && result.anchoring === 'UNANCHORED') {
      result.issues.push('UNANCHORED_SELF_CONSISTENCY_ONLY');
    }
  } catch (error) {
    result.issues.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
