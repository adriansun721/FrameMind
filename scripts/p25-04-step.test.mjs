import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("P25-04 runs the specified STEP through topology preview and keeps it preview-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-p25-04-"));
  const output = join(directory, "run.json");
  try {
    const result = spawnSync(process.execPath, ["scripts/run-p25-04-step.mjs", `--output=${output}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    assert.equal(manifest.task, "P25-04");
    assert.equal(manifest.input.sha256, "54d793bcf649d1e89d315c108e7e7faa61bd62cddf9737c1e56fda7b13c8fdca");
    assert.equal(manifest.topology.status, "blocked");
    assert.equal(manifest.topology.centerlineCount, 0);
    assert.equal(manifest.topology.issueCounts.blocking, 8);
    assert.equal(manifest.checks.rawLineCandidatesUsedAsCenterlines, false);
    assert.equal(manifest.checks.sourcePathExcluded, true);
    const artifact = JSON.parse(await readFile(join(directory, "preview.json"), "utf8"));
    assert.equal(artifact.intermediateState.engineeringGeometry.solidInstances.length, 8);
    assert.equal(artifact.topology.issues.length, 8);
    assert.equal(manifest.taskAcceptance, "pending");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
