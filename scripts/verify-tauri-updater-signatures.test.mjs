import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUpdaterSignatureKeyIds } from './verify-tauri-updater-signatures.mjs';

function armoredRecord(record) {
  return Buffer.from([
    'untrusted comment: test',
    Buffer.from(record).toString('base64'),
    '',
  ].join('\n')).toString('base64');
}

function recordWithKeyId(keyId) {
  return Buffer.concat([
    Buffer.from([0x45, 0x64]),
    Buffer.from(keyId),
    Buffer.alloc(32, 7),
  ]);
}

function makeFixture({ pubkeyId, signatureId }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-updater-signatures-'));
  const tauriConfig = path.join(dir, 'tauri.conf.json');
  const latestJson = path.join(dir, 'latest.json');

  fs.writeFileSync(tauriConfig, JSON.stringify({
    plugins: {
      updater: {
        pubkey: armoredRecord(recordWithKeyId(pubkeyId)),
      },
    },
  }));
  fs.writeFileSync(latestJson, JSON.stringify({
    version: '1.0.0',
    platforms: {
      'darwin-aarch64': {
        signature: armoredRecord(recordWithKeyId(signatureId)),
        url: 'https://example.test/app.tar.gz',
      },
    },
  }));

  return { tauriConfig, latestJson };
}

test('passes when updater signatures use the configured Tauri pubkey id', () => {
  const keyId = [1, 2, 3, 4, 5, 6, 7, 8];
  const fixture = makeFixture({ pubkeyId: keyId, signatureId: keyId });

  const result = verifyUpdaterSignatureKeyIds(fixture);

  assert.equal(result.platformCount, 1);
  assert.equal(result.keyId, '0807060504030201');
});

test('fails when updater signature key id differs from configured Tauri pubkey', () => {
  const fixture = makeFixture({
    pubkeyId: [1, 2, 3, 4, 5, 6, 7, 8],
    signatureId: [9, 10, 11, 12, 13, 14, 15, 16],
  });

  assert.throws(
    () => verifyUpdaterSignatureKeyIds(fixture),
    /signature key 100F0E0D0C0B0A09 does not match Tauri pubkey 0807060504030201/,
  );
});
