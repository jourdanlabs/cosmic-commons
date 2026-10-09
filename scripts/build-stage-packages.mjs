#!/usr/bin/env node
// Bundle each M1 stage package so npm pack works without the monorepo tree.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const MANIFEST = join(root, 'release', 'STAGE-BUNDLES.sha256');
if (esbuildVersion !== '0.25.12') throw new Error('Stage package build requires esbuild 0.25.12');

const STAGES = {
  validate: 'evaluateValidateStage',
  link: 'evaluateLinkStage',
  admit: 'evaluateAdmitStage',
  timebox: 'evaluateTimeboxStage',
  facts: 'evaluateFactsStage',
};

const stageBundlePaths = () =>
  [...Object.keys(STAGES), 'commons'].map((name) => join(root, 'packages', name, 'dist', 'stage.mjs'));

function readManifestMap() {
  const expected = new Map();
  for (const line of readFileSync(MANIFEST, 'utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error('Invalid stage bundle manifest entry');
    expected.set(match[2], match[1]);
  }
  return expected;
}

function writeManifest() {
  const lines = stageBundlePaths()
    .map((path) => {
      const rel = relative(root, path).split('\\').join('/');
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      return `${digest}  ${rel}`;
    })
    .sort((a, b) => a.slice(67).localeCompare(b.slice(67)));
  writeFileSync(MANIFEST, `${lines.join('\n')}\n`);
  return lines.length;
}

if (check) {
  const expected = readManifestMap();
  const actual = stageBundlePaths();
  if (actual.length !== expected.size) throw new Error('Stage bundle manifest/file count mismatch');
  for (const path of actual) {
    const rel = relative(root, path).split('\\').join('/');
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (digest !== expected.get(rel)) throw new Error(`Stage bundle differs from manifest: ${rel}; run npm run build`);
  }
  process.stdout.write(`REPRODUCIBLE: ${actual.length} stage bundles match ${relative(root, MANIFEST)}.\n`);
  process.exit(0);
}

const license = readFileSync(join(root, 'LICENSE'), 'utf8');

for (const [name, exportName] of Object.entries(STAGES)) {
  const pkgDir = join(root, 'packages', name);
  const entry = join(pkgDir, '.build-entry.mjs');
  writeFileSync(entry, `export { ${exportName} as evaluate } from '../../dist/src/m1/evaluate.js';\n`);
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: join(pkgDir, 'dist', 'stage.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    write: true,
    sourcemap: false,
    logLevel: 'silent',
  });
  writeFileSync(join(pkgDir, 'index.mjs'), `export { evaluate } from './dist/stage.mjs';\n`);
  writeFileSync(join(pkgDir, 'LICENSE'), license);
  writeFileSync(
    join(pkgDir, 'README.md'),
    `# @cosmic/commons-${name}\n\nM1 **${name.charAt(0).toUpperCase()}${name.slice(1)}** stage (bundled). Import \`evaluate\` from the package root.\n`,
  );
  writeFileSync(
    join(pkgDir, 'smoke.test.mjs'),
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { evaluate } from './index.mjs';\n\nconst policy = JSON.stringify({ schemaVersion: 'commons.m1-policy.v1', id: 'P', version: '1', priorityOrder: 'ascending' });\nconst schema = JSON.stringify({ schemaVersion: 'commons.field-schema.v1', id: 'S', version: '1', fields: [] });\nconst snap = JSON.stringify({ schemaVersion: 'commons.evidence-snapshot.v1', asOf: '2026-10-09T12:00:00.000Z', items: [{ id: 'W', priority: 1, owner: 'o', dependsOn: [] }], sources: [], evidence: [] });\n\ntest('${name} bundled evaluate loads', () => {\n  const out = evaluate(snap, schema, policy);\n  assert.ok(out);\n});\n`,
  );
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  delete pkg.dependencies['@cosmic/commons'];
  pkg.files = ['index.mjs', 'dist/stage.mjs', 'LICENSE', 'README.md', 'smoke.test.mjs'];
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  rmSync(entry);
}

const commonsDir = join(root, 'packages', 'commons');
writeFileSync(join(commonsDir, '.build-entry.mjs'), `export { evaluateEvidence as evaluate } from '../../dist/src/m1/evaluate.js';\n`);
mkdirSync(join(commonsDir, 'dist'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [join(commonsDir, '.build-entry.mjs')],
  outfile: join(commonsDir, 'dist', 'stage.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  write: true,
  sourcemap: false,
  logLevel: 'silent',
});
writeFileSync(join(commonsDir, 'index.mjs'), `export { evaluate } from './dist/stage.mjs';\n`);
writeFileSync(join(commonsDir, 'engines.mjs'), `export * from './dist/stage.mjs';\n`);
writeFileSync(join(commonsDir, 'LICENSE'), license);
const commonsPkg = JSON.parse(readFileSync(join(commonsDir, 'package.json'), 'utf8'));
delete commonsPkg.dependencies['@cosmic/commons'];
commonsPkg.files = ['index.mjs', 'engines.mjs', 'dist/stage.mjs', 'LICENSE', 'README.md'];
writeFileSync(join(commonsDir, 'package.json'), JSON.stringify(commonsPkg, null, 2) + '\n');
rmSync(join(commonsDir, '.build-entry.mjs'));

const count = writeManifest();
console.log(JSON.stringify({ bundledPackages: [...Object.keys(STAGES), 'commons'], stageManifest: relative(root, MANIFEST), files: count }));
