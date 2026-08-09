import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertIsolatedHelperTestHome } from "./remote-helper-settings-workflow.mjs";

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
  const testHome = path.join(
    os.tmpdir(),
    "cc-switch-remote-task7-example",
  );

  assert.equal(
    assertIsolatedHelperTestHome({
      CC_SWITCH_TEST_HOME: testHome,
      CC_SWITCH_HELPER_TEST_RUN_ID: "task7",
    }),
    path.resolve(testHome),
  );
  assert.throws(
    () =>
      assertIsolatedHelperTestHome({
        CC_SWITCH_TEST_HOME: testHome,
        CC_SWITCH_HELPER_TEST_RUN_ID: "different-task",
      }),
    /task-specific test home/,
  );
});
