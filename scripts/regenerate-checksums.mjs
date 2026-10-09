// Internal candidate helper: rebuild CHECKSUMS.sha256 using package-inventory rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoUntrackedReleaseFiles, listGitTrackedPackageFiles, MANIFEST } from './package-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assertNoUntrackedReleaseFiles(root);
const lines = listGitTrackedPackageFiles(root).map((path) => {
  const digest = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  return `${digest}  ${path}`;
});
writeFileSync(join(root, MANIFEST), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ manifest: MANIFEST, files: lines.length }));
