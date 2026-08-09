import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/release.yml'),
  'utf8',
);

test('release body uses only an explicitly fork-owned note or the fork fallback', () => {
  const prepareStep = releaseWorkflow.match(
    /- name: Prepare Release Notes[\s\S]*?(?=\n\s+- name:)/,
  )?.[0];

  assert.ok(prepareStep, 'Prepare Release Notes step must exist');
  assert.match(prepareStep, /docs\/release-notes\/\$\{TAG\}-remote-zh\.md/);
  assert.doesNotMatch(prepareStep, /docs\/release-notes\/\$\{TAG\}\.md/);
  assert.doesNotMatch(prepareStep, /docs\/release-notes\/\$\{TAG\}-zh\.md/);
  assert.match(prepareStep, /## CC Switch Remote \$\{TAG\}/);
});

test('Windows title and tray tooltip preserve the fork product identity', () => {
  const windowsConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'src-tauri/tauri.windows.conf.json'), 'utf8'),
  );
  const rustApp = fs.readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');

  assert.equal(windowsConfig.app.windows[0].title, 'CC Switch Remote');
  assert.match(rustApp, /\.tooltip\("CC Switch Remote"\)/);
  assert.doesNotMatch(rustApp, /\.tooltip\("CC Switch"\)/);
});
