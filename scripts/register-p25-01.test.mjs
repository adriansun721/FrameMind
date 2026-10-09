import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./register-p25-01.mjs", import.meta.url));

test("registers byte identity without recording source path or claiming a CAD reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p25-01-"));
  try {
    const input = join(directory, "secret-name.step");
    const output = join(directory, "manifest.json");
    const bytes = Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    await writeFile(input, bytes);
    const result = spawnSync(process.execPath, [script, `--input=${input}`, `--output=${output}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    assert.equal(manifest.input.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(manifest.input.sizeBytes, bytes.length);
    assert.equal(manifest.input.headerHex, bytes.toString("hex"));
    assert.equal(manifest.input.sourcePathRecorded, false);
    assert.equal(JSON.stringify(manifest).includes("secret-name.step"), false);
    assert.equal(manifest.independentReference.status, "not-recorded");
    assert.equal(manifest.acceptance.status, "baseline-incomplete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects non-STEP inputs", () => {
  const result = spawnSync(process.execPath, [script, "--input=README.md"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.step or \.stp/);
});
