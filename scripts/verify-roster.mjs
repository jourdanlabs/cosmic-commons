#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profileArg = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : 'm1-review';

const roster = JSON.parse(readFileSync(join(root, 'release/engine-roster.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(join(root, 'release/release-profile.json'), 'utf8'));

const STAGE_BINDINGS = {
  Validate: {
    source: 'src/m1/validate.ts',
    export: 'packages/validate/index.mjs',
    bundled: 'packages/validate/dist/stage.mjs',
    test: 'dist/tests/m1/m1-stages.test.js',
    example: 'examples/headless-adopter/run.mjs',
    traceSection: 'Validate',
    exportFn: 'evaluate',
    testNeedle: 'evaluateValidateStage',
  },
  Link: {
    source: 'src/m1/link.ts',
    export: 'packages/link/index.mjs',
    bundled: 'packages/link/dist/stage.mjs',
    test: 'dist/tests/m1/m1-stages.test.js',
    example: 'examples/headless-adopter/run.mjs',
    traceSection: 'Link',
    exportFn: 'evaluate',
    testNeedle: 'evaluateLinkStage',
  },
  Admit: {
    source: 'src/m1/admit.ts',
    export: 'packages/admit/index.mjs',
    bundled: 'packages/admit/dist/stage.mjs',
    test: 'dist/tests/m1/m1-replay-oracles.test.js',
    example: 'examples/headless-adopter/run.mjs',
    traceSection: 'Admit',
    exportFn: 'evaluate',
    testNeedle: 'evaluateAdmitStage',
  },
  Timebox: {
    source: 'src/m1/timebox.ts',
    export: 'packages/timebox/index.mjs',
    bundled: 'packages/timebox/dist/stage.mjs',
    test: 'dist/tests/m1/m1-stages.test.js',
    example: 'examples/headless-adopter/run.mjs',
    traceSection: 'Timebox',
    exportFn: 'evaluate',
    testNeedle: 'T01 oracle',
  },
  Facts: {
    source: 'src/m1/facts.ts',
    export: 'packages/facts/index.mjs',
    bundled: 'packages/facts/dist/stage.mjs',
    test: 'dist/tests/m1/m1-replay-oracles.test.js',
    example: 'examples/headless-adopter/run.mjs',
    traceSection: 'Facts',
    exportFn: 'evaluate',
    testNeedle: 'evaluateFactsStage',
  },
};

const { evaluateEvidence } = await import(pathToFileURL(join(root, 'dist/src/m1/evaluate.js')).href);
const rosterReceipt = evaluateEvidence(
  JSON.stringify({
    schemaVersion: 'commons.evidence-snapshot.v1',
    asOf: '2026-10-09T12:00:00.000Z',
    items: [{ id: 'WORK-A', priority: 1, owner: 'owner-work-a', dependsOn: [] }],
    sources: [{ id: 'SRC-1', content: { k: 1 } }],
    evidence: [
      {
        id: 'EV-1',
        itemId: 'WORK-A',
        subjectId: 'WORK-A',
        field: 'approval',
        issuer: 'authority-approval',
        sourceId: 'SRC-1',
        observedAt: '2026-10-08T12:00:00.000Z',
        expiresAt: '2026-10-10T12:00:00.000Z',
        value: true,
        dependsOn: [],
      },
    ],
  }),
  JSON.stringify({
    schemaVersion: 'commons.field-schema.v1',
    id: 'ROSTER-CHECK',
    version: '1',
    fields: [
      {
        name: 'approval',
        type: 'boolean',
        issuerAuthorities: ['authority-approval'],
        required: true,
        eligibility: false,
        disqualifier: false,
        owner: 'owner-approval',
      },
    ],
  }),
  JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'P', version: '1', priorityOrder: 'ascending' }),
);

async function checkStage(name, status) {
  const binding = STAGE_BINDINGS[name];
  if (!binding) return [`${name}: no binding table entry`];
  const missing = [];
  for (const key of ['source', 'export', 'bundled', 'test', 'example']) {
    const rel = binding[key];
    if (!existsSync(join(root, rel))) missing.push(`${name}.${key}: missing ${rel}`);
  }
  try {
    const mod = await import(pathToFileURL(join(root, binding.export)).href);
    if (typeof mod[binding.exportFn] !== 'function') {
      missing.push(`${name}.export: ${binding.export} missing export ${binding.exportFn}`);
    }
  } catch (error) {
    missing.push(`${name}.export: failed to load ${binding.export}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const testSource = readFileSync(join(root, binding.test), 'utf8');
  if (!testSource.includes(binding.testNeedle)) missing.push(`${name}.test: missing needle ${binding.testNeedle}`);
  if (!rosterReceipt.ok) missing.push(`${name}.traceSection: evaluateEvidence failed for roster fixture`);
  else {
    const traces = rosterReceipt.receipt.items[0]?.traces ?? [];
    if (!traces.some((t) => t.stage === binding.traceSection)) {
      missing.push(`${name}.traceSection: missing trace stage ${binding.traceSection}`);
    }
  }
  const rosterRow = roster.stages.find((s) => s.name === name);
  if (!rosterRow) missing.push(`${name}: not listed in engine-roster.json`);
  else if (rosterRow.status !== status) missing.push(`${name}: roster status ${rosterRow.status} expected ${status}`);
  return missing;
}

if (profileArg === 'full') {
  const notImplemented = roster.stages.filter((s) => s.status === 'NOT_IMPLEMENTED').map((s) => s.name);
  console.error(JSON.stringify({ valid: false, profile: 'full', notImplementedStages: notImplemented }));
  process.exit(1);
}

if (profiles.profileId !== profileArg) {
  console.error(JSON.stringify({ valid: false, profile: profileArg, error: 'Unknown profile: ' + profileArg }));
  process.exit(1);
}

const required = new Set(profiles.requiredStages);
const failures = [];
for (const name of required) failures.push(...(await checkStage(name, 'M1_REQUIRED')));

if (failures.length) {
  console.error(JSON.stringify({ valid: false, profile: profileArg, failures }));
  process.exit(1);
}
console.log(JSON.stringify({ valid: true, profile: profileArg, requiredStages: [...required], boundStages: [...required] }));
