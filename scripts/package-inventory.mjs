// Shared release inventory rules for VERIFY-PACKAGE.mjs and regenerate-checksums.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MANIFEST = 'CHECKSUMS.sha256';

export function skipReleaseRootGitMetadata(prefix, entry) {
  if (prefix !== '') return false;
  if (entry.name !== '.git') return false;
  return entry.isDirectory() || entry.isFile();
}

export function skipInventoryDirectory(prefix, entry) {
  // Baseline F0-A: skip release-root `data/` only (not nested paths).
  if (prefix === '' && entry.name === 'data') return true;
  return false;
}

/** @returns {string[]} paths relative to root, sorted */
export function listPackageFiles(root, options = {}) {
  const manifestMode = options.manifestMode === true;
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + name);
      if (skipReleaseRootGitMetadata(prefix, entry)) continue;
      if (entry.isDirectory()) {
        if (manifestMode && entry.name === 'node_modules') continue;
        if (skipInventoryDirectory(prefix, entry)) continue;
        walk(path, name + '/');
      } else if (entry.isFile() && name !== MANIFEST) {
        if (manifestMode && entry.name === '.DS_Store') continue;
        if (manifestMode && entry.name.endsWith('.tgz')) continue;
        files.push(name);
      }
    }
  }
  walk(root);
  files.sort();
  return files;
}

/** Root-only release `data/` skip (matches F0-A baseline). */
export function skipManifestGitPath(path) {
  if (path === MANIFEST) return true;
  if (path === 'data' || path.startsWith('data/')) return true;
  return false;
}

export function assertNoUntrackedReleaseFiles(root) {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('git status failed');
  const untracked = status.stdout
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter((path) => path && !path.startsWith('node_modules/') && path !== '.DS_Store' && !path.endsWith('.tgz'));
  if (untracked.length) {
    throw new Error(`Untracked paths refuse manifest regen: ${untracked.join(', ')}`);
  }
}

/** Manifest paths from git index only (no dirty-tree tarball drift). */
export function listGitTrackedPackageFiles(root) {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root });
  if (listed.status !== 0) throw new Error('git ls-files failed');
  const files = listed.stdout
    .toString('utf8')
    .split('\0')
    .filter((path) => path && !skipManifestGitPath(path))
    .sort();
  return files;
}

export function skipReleaseRootGitPath(path) {
  return path === '.git' || path.startsWith('.git/');
}

function splitGitLsFiles(stdout) {
  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function gitLsOthers(root, ignored) {
  const args = ['ls-files', '-z', '-o'];
  if (ignored) args.push('-i');
  args.push('--exclude-standard');
  const listed = spawnSync('git', args, { cwd: root });
  if (listed.status !== 0) throw new Error('git ls-files untracked failed');
  return splitGitLsFiles(listed.stdout);
}

function collectFilesUnder(directory, prefix, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      files.push(name);
      continue;
    }
    if (entry.isDirectory()) {
      collectFilesUnder(path, name + '/', files);
    } else if (entry.isFile() && name !== MANIFEST) {
      files.push(name);
    }
  }
}

/** Git omits paths under nested `.git/`; collect them for verify (not root `.git`). */
export function listNestedDotGitFiles(root) {
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const path = join(directory, entry.name);
      if (skipReleaseRootGitMetadata(prefix, entry)) continue;
      if (entry.isDirectory()) {
        if (skipInventoryDirectory(prefix, entry)) continue;
        if (entry.name === '.git') {
          collectFilesUnder(path, name + '/', files);
          continue;
        }
        walk(path, name + '/');
      }
    }
  }
  walk(root);
  return files;
}

function includeWorktreePath(path, allowDevDependencies) {
  if (skipReleaseRootGitPath(path)) return false;
  if (skipManifestGitPath(path)) return false;
  if (allowDevDependencies && (path === 'node_modules' || path.startsWith('node_modules/'))) return false;
  return true;
}

/** Tracked plus worktree files for VERIFY-PACKAGE (strict; not for manifest regen). */
export function listGitWorktreePackageFiles(root, options = {}) {
  const allowDevDependencies = options.allowDevDependencies === true;
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root });
  if (tracked.status !== 0) throw new Error('git ls-files failed');
  const files = new Set();
  for (const path of [
    ...splitGitLsFiles(tracked.stdout),
    ...gitLsOthers(root, false),
    ...gitLsOthers(root, true),
    ...listNestedDotGitFiles(root),
  ]) {
    if (!includeWorktreePath(path, allowDevDependencies)) continue;
    files.add(path);
  }
  return [...files].sort();
}

/** Files that must appear in CHECKSUMS for this tree (git index in a repo, else directory walk). */
export function releaseInventory(root, options = {}) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    return listGitWorktreePackageFiles(root, options);
  }
  // Archives and test copies have no git index; walk the tree so node_modules cannot hide extra files.
  const allowDevDependencies = options.allowDevDependencies === true;
  if (allowDevDependencies) {
    return listPackageFiles(root, { manifestMode: true });
  }
  return listPackageFiles(root, { manifestMode: false });
}

export function releaseInventorySkipped(root, options = {}) {
  if (options.allowDevDependencies !== true) return [];
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    return ['node_modules/'];
  }
  return [];
}

export function readManifestMap(root) {
  const expected = new Map();
  for (const line of readFileSync(join(root, MANIFEST), 'utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || match[2].startsWith('/') || match[2].split('/').some((s) => !s || s === '.' || s === '..') || match[2].includes('\\') || expected.has(match[2])) {
      throw new Error('Invalid manifest entry');
    }
    expected.set(match[2], match[1]);
  }
  return expected;
}
