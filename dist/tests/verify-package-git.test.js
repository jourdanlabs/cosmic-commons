// Copyright 2026 Leland Jourdan II / C&L Strategy
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync, symlinkSync, readFileSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { packageRoot } from "../src/package-root.js";
function runVerify(packageDir) {
    return spawnSync(process.execPath, [join(packageDir, 'VERIFY-PACKAGE.mjs')], { cwd: packageDir, encoding: 'utf8' });
}
function copyReleaseTree(target) {
    const listed = spawnSync('git', ['ls-files', '-z'], { cwd: packageRoot });
    assert.equal(listed.status, 0, listed.stderr?.toString());
    for (const rel of listed.stdout.toString('utf8').split('\0').filter(Boolean)) {
        if (rel.startsWith('node_modules/'))
            continue;
        const src = join(packageRoot, rel);
        assert.ok(lstatSync(src).isFile(), rel);
        const dest = join(target, rel);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
    }
}
test('VERIFY-PACKAGE ignores release-root .git metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commons-verify-'));
    try {
        copyReleaseTree(dir);
        mkdirSync(join(dir, '.git', 'objects'), { recursive: true });
        writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        assert.equal(runVerify(dir).status, 0, runVerify(dir).stderr + runVerify(dir).stdout);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('VERIFY-PACKAGE still fails on checksum drift and unexpected runtime files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commons-verify-'));
    try {
        copyReleaseTree(dir);
        mkdirSync(join(dir, '.git', 'objects'), { recursive: true });
        writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        writeFileSync(join(dir, '.git', 'config'), '[core]\n');
        assert.equal(runVerify(dir).status, 0);
        writeFileSync(join(dir, 'README.md'), readFileSync(join(dir, 'README.md'), 'utf8') + '\n');
        assert.notEqual(runVerify(dir).status, 0);
        writeFileSync(join(dir, 'README.md'), readFileSync(join(packageRoot, 'README.md')));
        writeFileSync(join(dir, 'unexpected-runtime.mjs'), 'export {};\n');
        assert.notEqual(runVerify(dir).status, 0);
        rmSync(join(dir, 'unexpected-runtime.mjs'));
        mkdirSync(join(dir, 'nested', '.git'), { recursive: true });
        writeFileSync(join(dir, 'nested', '.git', 'hidden.mjs'), 'export const hidden = 1;\n');
        assert.notEqual(runVerify(dir).status, 0);
        rmSync(join(dir, 'nested', '.git', 'hidden.mjs'));
        writeFileSync(join(dir, 'link-target.txt'), 'x');
        symlinkSync(join(dir, 'link-target.txt'), join(dir, 'symlink-leak.txt'));
        assert.notEqual(runVerify(dir).status, 0);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('VERIFY-PACKAGE fails on nested data, build temp, and node_modules hiding places', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commons-verify-hide-'));
    try {
        copyReleaseTree(dir);
        mkdirSync(join(dir, '.git', 'objects'), { recursive: true });
        writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        assert.equal(runVerify(dir).status, 0);
        mkdirSync(join(dir, 'dist', 'src', 'm1', 'data'), { recursive: true });
        writeFileSync(join(dir, 'dist', 'src', 'm1', 'data', 'payload.js'), 'export const x=1;\n');
        assert.notEqual(runVerify(dir).status, 0, 'nested data path must fail');
        rmSync(join(dir, 'dist', 'src', 'm1', 'data'), { recursive: true, force: true });
        mkdirSync(join(dir, 'dist', 'src', '.build-x'), { recursive: true });
        writeFileSync(join(dir, 'dist', 'src', '.build-x', 'payload.js'), 'export const x=1;\n');
        assert.notEqual(runVerify(dir).status, 0, '.build-x path must fail');
        rmSync(join(dir, 'dist', 'src', '.build-x'), { recursive: true, force: true });
        mkdirSync(join(dir, 'node_modules', 'evil'), { recursive: true });
        writeFileSync(join(dir, 'node_modules', 'evil', 'index.js'), 'export const x=1;\n');
        assert.notEqual(runVerify(dir).status, 0, 'node_modules path must fail');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
