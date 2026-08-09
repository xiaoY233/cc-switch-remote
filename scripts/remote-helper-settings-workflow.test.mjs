import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertIsolatedHelperTestHome,
  createIsolatedHelperTestHome,
  runIsolatedSettingsWorkflow,
} from "./remote-helper-settings-workflow.mjs";

test("helper workflow fails closed without an explicit task test home", () => {
  assert.throws(
    () => assertIsolatedHelperTestHome({}),
    /CC_SWITCH_TEST_HOME must be explicitly set/,
  );
});

test("helper workflow rejects user and production data directories", () => {
  for (const unsafePath of [
    os.homedir(),
    path.join(os.homedir(), ".cc-switch-remote"),
    path.join(os.homedir(), ".cc-switch-remote-dev"),
  ]) {
    assert.throws(
      () =>
        assertIsolatedHelperTestHome({
          CC_SWITCH_TEST_HOME: unsafePath,
          CC_SWITCH_HELPER_TEST_RUN_ID: "task7",
        }),
      /isolated temporary directory/,
    );
  }
});

test("helper workflow accepts only a matching task-specific temporary root", () => {
  const testHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-switch-remote-task7-example-"),
  );

  try {
    assert.equal(
      assertIsolatedHelperTestHome({
        CC_SWITCH_TEST_HOME: testHome,
        CC_SWITCH_HELPER_TEST_RUN_ID: "task7",
      }),
      fs.realpathSync(testHome),
    );
    assert.throws(
      () =>
        assertIsolatedHelperTestHome({
          CC_SWITCH_TEST_HOME: testHome,
          CC_SWITCH_HELPER_TEST_RUN_ID: "different-task",
        }),
      /task-specific test home/,
    );
  } finally {
    fs.rmSync(testHome, { recursive: true, force: true });
  }
});

test("helper workflow rejects a symlink test-home alias before spawning", () => {
  const realHome = createIsolatedHelperTestHome("task7-symlink");
  const alias = `${realHome}-alias`;
  try {
    fs.symlinkSync(realHome, alias, "dir");
    assert.throws(
      () =>
        assertIsolatedHelperTestHome({
          CC_SWITCH_TEST_HOME: alias,
          CC_SWITCH_HELPER_TEST_RUN_ID: "task7-symlink",
        }),
      /symlink|real path/,
    );
  } finally {
    fs.rmSync(alias, { force: true });
    fs.rmSync(realHome, { recursive: true, force: true });
  }
});

test(
  "runs the real helper settings workflow in a harness-owned temporary root",
  { timeout: 120_000 },
  () => {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const build = spawnSync(
      "cargo",
      [
        "build",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--bin",
        "cc-switch-remote-helper",
        "--no-default-features",
        "--features",
        "proxy-runtime",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const helperName =
      process.platform === "win32"
        ? "cc-switch-remote-helper.exe"
        : "cc-switch-remote-helper";
    const result = runIsolatedSettingsWorkflow({
      ...process.env,
      CC_SWITCH_HELPER_BIN: path.join(
        repoRoot,
        "src-tauri",
        "target",
        "debug",
        helperName,
      ),
      CC_SWITCH_HELPER_TEST_RUN_ID: "task7-real",
    });

    assert.equal(result.settingsGetRedacted, true);
    assert.equal(result.settingsSavePreservedSecretsAndMarker, true);
    assert.equal(result.failedSavePreservedBytes, true);
    assert.equal(result.upstreamSettingsUnchanged, true);
    assert.equal(result.upstreamOverrideRejected, true);
    assert.equal(result.symlinkOverrideRejected, true);
    assert.equal(result.privateSettingsMode, true);
  },
);
