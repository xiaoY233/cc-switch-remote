#!/usr/bin/env node
import fs from 'node:fs';

function parseArgs(argv) {
  const args = {
    latestJson: 'latest.json',
    tauriConfig: 'src-tauri/tauri.conf.json',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === '--latest-json') args.latestJson = next();
    else if (arg === '--tauri-config') args.tauriConfig = next();
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return `Usage: node scripts/verify-tauri-updater-signatures.mjs [options]

Options:
  --latest-json <file>    Tauri updater metadata, default: latest.json
  --tauri-config <file>   Tauri config containing plugins.updater.pubkey
`;
}

function decodeArmoredBase64(value, label) {
  const text = Buffer.from(value.trim(), 'base64').toString('utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].startsWith('untrusted comment:')) {
    throw new Error(`${label} is not a valid minisign armored value`);
  }
  return Buffer.from(lines[1], 'base64');
}

function minisignKeyId(record, label) {
  if (record.length < 10) {
    throw new Error(`${label} is too short to contain a minisign key id`);
  }
  return record.subarray(2, 10);
}

function formatKeyId(keyId) {
  return Buffer.from(keyId).reverse().toString('hex').toUpperCase();
}

export function verifyUpdaterSignatureKeyIds({ latestJson, tauriConfig }) {
  const config = JSON.parse(fs.readFileSync(tauriConfig, 'utf8'));
  const pubkey = config?.plugins?.updater?.pubkey;
  if (typeof pubkey !== 'string' || pubkey.trim() === '') {
    throw new Error(`${tauriConfig} is missing plugins.updater.pubkey`);
  }

  const expectedKeyId = minisignKeyId(decodeArmoredBase64(pubkey, 'Tauri updater pubkey'), 'Tauri updater pubkey');
  const latest = JSON.parse(fs.readFileSync(latestJson, 'utf8'));
  const platforms = latest?.platforms;
  if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
    throw new Error(`${latestJson} has no updater platforms`);
  }

  const errors = [];
  for (const [platform, metadata] of Object.entries(platforms)) {
    if (typeof metadata?.signature !== 'string' || metadata.signature.trim() === '') {
      errors.push(`${platform}: missing signature`);
      continue;
    }

    try {
      const signatureKeyId = minisignKeyId(
        decodeArmoredBase64(metadata.signature, `${platform} signature`),
        `${platform} signature`,
      );
      if (!signatureKeyId.equals(expectedKeyId)) {
        errors.push(
          `${platform}: signature key ${formatKeyId(signatureKeyId)} does not match Tauri pubkey ${formatKeyId(expectedKeyId)}`,
        );
      }
    } catch (error) {
      errors.push(`${platform}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return {
    platformCount: Object.keys(platforms).length,
    keyId: formatKeyId(expectedKeyId),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = verifyUpdaterSignatureKeyIds({
    latestJson: args.latestJson,
    tauriConfig: args.tauriConfig,
  });
  console.log(`Verified ${result.platformCount} updater platform signature key ids with Tauri pubkey ${result.keyId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
