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
  let rootStat;
  let realPath;
  try {
    rootStat = fs.lstatSync(resolved);
    realPath = fs.realpathSync(resolved);
  } catch {
    throw new Error("helper workflow test home must be a harness-created directory");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("helper workflow test home must not be a symlink");
  }
  const lexicalTmp = path.resolve(os.tmpdir());
  const realTmp = fs.realpathSync(lexicalTmp);
  const relativeToTmp = path.relative(realTmp, realPath);
  const relativeToLexicalTmp = path.relative(lexicalTmp, resolved);
  const inputRelative =
    !relativeToLexicalTmp.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeToLexicalTmp)
      ? relativeToLexicalTmp
      : path.relative(realTmp, resolved);
  const basename = path.basename(realPath);
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
  if (inputRelative !== relativeToTmp) {
    throw new Error("helper workflow test home real path contains a symlink alias");
  }
  return realPath;
}

export function createIsolatedHelperTestHome(runId) {
  if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("CC_SWITCH_HELPER_TEST_RUN_ID must identify this task");
  }
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), `${SAFE_PREFIX}${runId}-`),
  );
  return assertIsolatedHelperTestHome({
    CC_SWITCH_TEST_HOME: root,
    CC_SWITCH_HELPER_TEST_RUN_ID: runId,
  });
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

  const privateSettingsMode =
    process.platform === "win32" ||
    (fs.statSync(settingsPath).mode & 0o777) === 0o600;
  if (!privateSettingsMode) {
    throw new Error("settings file permissions are not private");
  }

  const directOverride = runHelper(
    helperPath,
    ["settings", "set-app-config-dir", upstreamDir],
    env,
  );
  if (directOverride.ok) {
    throw new Error("helper accepted the upstream app config directory");
  }
  const alias = path.join(testHome, "upstream-config-alias");
  fs.symlinkSync(
    upstreamDir,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const symlinkOverride = runHelper(
    helperPath,
    ["settings", "set-app-config-dir", alias],
    env,
  );
  if (symlinkOverride.ok) {
    throw new Error("helper accepted a symlink alias to the upstream app config directory");
  }
  const configAfterRejectedOverrides = runHelper(
    helperPath,
    ["settings", "app-config-dir"],
    env,
  );
  if (
    !configAfterRejectedOverrides.ok ||
    path.resolve(configAfterRejectedOverrides.data) !== expectedConfigDir
  ) {
    throw new Error("rejected override changed the active helper config directory");
  }

  const beforeFailure = sha256(settingsPath);
  fs.chmodSync(expectedConfigDir, 0o500);
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
    fs.chmodSync(expectedConfigDir, 0o700);
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
    upstreamOverrideRejected: true,
    symlinkOverrideRejected: true,
    privateSettingsMode,
  };
}

export function runIsolatedSettingsWorkflow(env = process.env) {
  const runId = env.CC_SWITCH_HELPER_TEST_RUN_ID?.trim();
  const testHome = createIsolatedHelperTestHome(runId);
  try {
    return runSettingsWorkflow({
      ...env,
      CC_SWITCH_TEST_HOME: testHome,
      CC_SWITCH_HELPER_TEST_RUN_ID: runId,
    });
  } finally {
    fs.rmSync(testHome, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.stdout.write(`${JSON.stringify(runIsolatedSettingsWorkflow())}\n`);
}
