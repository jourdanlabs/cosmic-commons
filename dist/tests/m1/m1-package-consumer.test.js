// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { packageRoot } from "../../src/package-root.js";
test('bundled validate package runs with monorepo removed', () => {
    const consumer = mkdtempSync(join(tmpdir(), 'commons-pack-'));
    let packedTarball = '';
    try {
        const pack = spawnSync('npm', ['pack', '--silent'], {
            cwd: join(packageRoot, 'packages', 'validate'),
            encoding: 'utf8',
        });
        assert.equal(pack.status, 0, pack.stderr);
        const tarball = pack.stdout.trim().split('\n').pop();
        packedTarball = join(packageRoot, 'packages', 'validate', tarball);
        assert.ok(tarball.endsWith('.tgz'));
        cpSync(join(packageRoot, 'packages', 'validate', tarball), join(consumer, tarball));
        mkdirSync(join(consumer, 'node_modules', '@cosmic', 'commons-validate'), { recursive: true });
        const extract = spawnSync('tar', ['-xzf', tarball, '-C', join(consumer, 'node_modules', '@cosmic', 'commons-validate'), '--strip-components=1'], {
            cwd: consumer,
        });
        assert.equal(extract.status, 0);
        writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module', dependencies: { '@cosmic/commons-validate': 'file:./node_modules/@cosmic/commons-validate' } }));
        writeFileSync(join(consumer, 'run.mjs'), `import { evaluate } from '@cosmic/commons-validate';
const schema = JSON.stringify({ schemaVersion:'commons.field-schema.v1', id:'S', version:'1', fields:[] });
const policy = JSON.stringify({ schemaVersion:'commons.m1-policy.v1', id:'P', version:'1', priorityOrder:'ascending' });
const snap = JSON.stringify({ schemaVersion:'commons.evidence-snapshot.v1', asOf:'2026-10-09T12:00:00.000Z', items:[{ id:'W', priority:1, owner:'o', dependsOn:[] }], sources:[], evidence:[] });
if (!evaluate(snap, schema, policy).snapshot) process.exit(2);
`);
        const run = spawnSync(process.execPath, ['run.mjs'], { cwd: consumer, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr + run.stdout);
        const packed = readFileSync(join(consumer, 'node_modules', '@cosmic', 'commons-validate', 'dist', 'stage.mjs'), 'utf8');
        assert.ok(packed.length > 10_000, 'expected bundled stage artifact, not a stub re-export');
    }
    finally {
        rmSync(consumer, { recursive: true, force: true });
        if (packedTarball)
            rmSync(packedTarball, { force: true });
    }
});
