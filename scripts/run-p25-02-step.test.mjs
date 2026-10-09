import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("records the isolated protocol without persisting the source path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p25-02-"));
  try {
    const input = join(directory, "source.step");
    const output = join(directory, "manifest.json");
    await writeFile(input, "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=PRODUCT('x',$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n");
    const result = spawnSync(process.execPath, ["scripts/run-p25-02-step.mjs", `--input=${input}`, `--output=${output}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    assert.equal(manifest.task, "P25-02");
    assert.equal(manifest.acceptance.realSpecifiedStepParsed, true);
    assert.equal(manifest.acceptance.corruptInputContained, true);
    assert.equal(manifest.input.sourcePathRecorded, false);
    assert.equal(manifest.protocol.absolutePathInMessages, false);
    assert.equal(manifest.failureInjection.absolutePathInMessages, false);
    assert.equal(JSON.stringify(manifest).includes(input), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
