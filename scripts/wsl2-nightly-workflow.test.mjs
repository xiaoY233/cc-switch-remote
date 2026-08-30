import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflow = fs.readFileSync(
  path.join(repoRoot, ".github", "workflows", "wsl2-nightly.yml"),
  "utf8",
);

function workflowStep(name, nextName) {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `workflow step not found: ${name}`);
  const end = nextName
    ? workflow.indexOf(`      - name: ${nextName}`, start + 1)
    : workflow.length;
  assert.notEqual(end, -1, `next workflow step not found: ${nextName}`);
  return workflow.slice(start, end);
}

test("WSL2 nightly compiles once with native temp and runs saved binaries", () => {
  const compileStep = workflowStep(
    "Compile backend tests with native temp",
    "Run Windows-to-WSL2 filesystem contract",
  );
  assert.match(compileStep, /TEMP: \$\{\{ runner\.temp \}\}/);
  assert.match(compileStep, /--no-run --message-format=json/);
  assert.match(compileStep, /CC_SWITCH_LIB_TEST_EXE=/);
  assert.match(compileStep, /CC_SWITCH_TEST_BINARIES_FILE=/);

  const contractStep = workflowStep(
    "Run Windows-to-WSL2 filesystem contract",
    "Run full test suite against WSL2-backed home",
  );
  assert.match(contractStep, /\$env:TEMP = \$env:CC_SWITCH_WSL_TEST_TEMP/);
  assert.match(contractStep, /& \$env:CC_SWITCH_LIB_TEST_EXE/);
  assert.doesNotMatch(contractStep, /cargo test/);

  const fullSuiteStep = workflowStep(
    "Run full test suite against WSL2-backed home",
  );
  assert.match(fullSuiteStep, /\$env:TEMP = \$env:CC_SWITCH_WSL_TEST_TEMP/);
  assert.match(
    fullSuiteStep,
    /foreach \(\$testBinary in @\(\$testBinaries\)\)/,
  );
  assert.match(fullSuiteStep, /& \$testBinary --test-threads=1/);
  assert.doesNotMatch(fullSuiteStep, /cargo test/);
});
