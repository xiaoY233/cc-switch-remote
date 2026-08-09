import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SAFE_PREFIX = "cc-switch-remote-";

export function assertIsolatedHelperTestHome(env = process.env) {
  const rawHome = env.CC_SWITCH_TEST_HOME?.trim();
  if (!rawHome) {
    throw new Error("CC_SWITCH_TEST_HOME must be explicitly set");
  }
  const runId = env.CC_SWITCH_HELPER_TEST_RUN_ID?.trim();
  if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("CC_SWITCH_HELPER_TEST_RUN_ID must identify this task");
  }

  const resolved = path.resolve(rawHome);
  const relativeToTmp = path.relative(path.resolve(os.tmpdir()), resolved);
  const basename = path.basename(resolved);
  if (
    relativeToTmp === "" ||
    relativeToTmp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTmp) ||
    !basename.startsWith(SAFE_PREFIX)
  ) {
    throw new Error("helper workflow requires an isolated temporary directory");
  }
  if (!basename.includes(runId)) {
    throw new Error("helper workflow requires a task-specific test home");
  }
  return resolved;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runHelper(helperPath, args, env) {
  const testHome = assertIsolatedHelperTestHome(env);
  const childEnv = {
    ...env,
    CC_SWITCH_TEST_HOME: testHome,
  };
  // Assert immediately before every child process. Do not allow a caller to
  // inherit an unset/rewritten home between workflow steps.
  assertIsolatedHelperTestHome(childEnv);
  const result = spawnSync(helperPath, ["--json", ...args], {
    encoding: "utf8",
    env: childEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`helper exited ${result.status}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

export function runSettingsWorkflow(env = process.env) {
  const testHome = assertIsolatedHelperTestHome(env);
  const helperPath = path.resolve(env.CC_SWITCH_HELPER_BIN ?? "");
  if (!env.CC_SWITCH_HELPER_BIN || !fs.existsSync(helperPath)) {
    throw new Error("CC_SWITCH_HELPER_BIN must point to the built helper");
  }

  const expectedConfigDir = path.join(testHome, ".cc-switch-remote");
  const upstreamDir = path.join(testHome, ".cc-switch");
  const upstreamSettings = path.join(upstreamDir, "settings.json");
  fs.mkdirSync(upstreamDir, { recursive: true });
  fs.writeFileSync(upstreamSettings, "upstream-settings-sentinel");
  const upstreamBefore = sha256(upstreamSettings);

  const resolvedConfig = runHelper(
    helperPath,
    ["settings", "app-config-dir"],
    env,
  );
  if (!resolvedConfig.ok || path.resolve(resolvedConfig.data) !== expectedConfigDir) {
    throw new Error("helper resolved outside the asserted isolated config directory");
  }

  const initialGet = runHelper(helperPath, ["settings", "get"], env);
  if (!initialGet.ok) throw new Error("initial settings get failed");
  const initial = {
    ...initialGet.data,
    webdavSync: {
      enabled: false,
      autoSync: false,
      baseUrl: "https://dav.example.com",
      username: "test-user",
      password: "test-webdav-secret",
      remoteRoot: "cc-switch-sync",
      profile: "default",
      status: {},
    },
    s3Sync: {
      enabled: false,
      autoSync: false,
      region: "us-east-1",
      bucket: "settings-test",
      accessKeyId: "test-ak",
      secretAccessKey: "test-s3-secret",
      endpoint: "https://s3.example.com",
      remoteRoot: "cc-switch-sync",
      profile: "default",
      status: {},
    },
  };
  const firstSave = runHelper(
    helperPath,
    ["settings", "save", JSON.stringify(initial)],
    env,
  );
  if (!firstSave.ok) throw new Error("initial settings save failed");

  // localMigrations is backend-owned, so the public save API correctly ignores
  // an incoming marker. Seed it as an isolated backend fixture, then prove the
  // following redacted helper save cannot clear it.
  const settingsPath = path.join(expectedConfigDir, "settings.json");
  if (path.dirname(settingsPath) !== expectedConfigDir) {
    throw new Error("settings fixture escaped the isolated config directory");
  }
  const backendSeed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  backendSeed.localMigrations = {
    codexProviderTemplateV1: {
      completedAt: "2026-08-10T00:00:00Z",
      migratedProviderIds: ["legacy"],
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(backendSeed));

  const redactedGet = runHelper(helperPath, ["settings", "get"], env);
  if (
    !redactedGet.ok ||
    redactedGet.data.webdavSync?.password !== "" ||
    redactedGet.data.s3Sync?.secretAccessKey !== ""
  ) {
    throw new Error("settings get did not redact stored secrets");
  }
  const redactedPayload = {
    ...redactedGet.data,
    language: "zh",
  };
  delete redactedPayload.localMigrations;
  const secondSave = runHelper(
    helperPath,
    ["settings", "save", JSON.stringify(redactedPayload)],
    env,
  );
  if (!secondSave.ok) throw new Error("redacted settings save failed");

  const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (
    persisted.webdavSync?.password !== "test-webdav-secret" ||
    persisted.s3Sync?.secretAccessKey !== "test-s3-secret" ||
    persisted.localMigrations?.codexProviderTemplateV1?.migratedProviderIds?.[0] !==
      "legacy" ||
    persisted.language !== "zh"
  ) {
    throw new Error("redacted secrets or backend migration marker were not preserved");
  }

  const beforeFailure = sha256(settingsPath);
  fs.chmodSync(settingsPath, 0o400);
  let failedSave;
  try {
    failedSave = runHelper(
      helperPath,
      [
        "settings",
        "save",
        JSON.stringify({ ...redactedPayload, language: "ja" }),
      ],
      env,
    );
  } finally {
    fs.chmodSync(settingsPath, 0o600);
  }
  if (failedSave.ok || sha256(settingsPath) !== beforeFailure) {
    throw new Error("failed settings save did not preserve the previous file");
  }
  if (sha256(upstreamSettings) !== upstreamBefore) {
    throw new Error("helper workflow modified the upstream settings file");
  }

  return {
    testHome,
    configDir: expectedConfigDir,
    settingsGetRedacted: true,
    settingsSavePreservedSecretsAndMarker: true,
    failedSavePreservedBytes: true,
    upstreamSettingsUnchanged: true,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.stdout.write(`${JSON.stringify(runSettingsWorkflow())}\n`);
}
