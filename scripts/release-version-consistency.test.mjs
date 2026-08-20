import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseVersion = '3.20.1';

test('release metadata uses the planned v3.20.1 version consistently', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  const tauriConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const cargoToml = fs.readFileSync(
    path.join(repoRoot, 'src-tauri', 'Cargo.toml'),
    'utf8',
  );
  const cargoLock = fs.readFileSync(
    path.join(repoRoot, 'src-tauri', 'Cargo.lock'),
    'utf8',
  );

  assert.equal(packageJson.version, releaseVersion);
  assert.equal(tauriConfig.version, releaseVersion);
  assert.match(cargoToml, new RegExp(`^version = \"${releaseVersion}\"$`, 'm'));
  assert.match(
    cargoLock,
    new RegExp(
      `name = \"cc-switch-remote\"\\nversion = \"${releaseVersion}\"`,
    ),
  );
});
