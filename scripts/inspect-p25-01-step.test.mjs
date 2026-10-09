import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("records reproducible STEP lexical diagnostics without claiming CAD reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "p25-01-inspect-"));
  try {
    const input = join(dir, "assembly.stp");
    const output = join(dir, "report.json");
    await writeFile(input, `ISO-10303-21;\nHEADER;\nFILE_SCHEMA (( 'CONFIG_CONTROL_DESIGN' ));\nENDSEC;\nDATA;\n#1 = PRODUCT ( 'A' );\n#2 = PRODUCT_DEFINITION ( 'B' );\n#3 = NEXT_ASSEMBLY_USAGE_OCCURRENCE ( 'C' );\n#4 = CARTESIAN_POINT ( 'P', ( 1.0, -2.0, 3.0 ) );\nENDSEC;\nEND-ISO-10303-21;\n`);
    const result = spawnSync(process.execPath, ["scripts/inspect-p25-01-step.mjs", `--input=${input}`, `--output=${output}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.referenceKind, "step-part21-lexical-diagnostic");
    assert.equal(report.independentCadReference, false);
    assert.equal(report.entityCounts.total, 4);
    assert.equal(report.entityCounts.products, 1);
    assert.equal(report.entityCounts.assemblyInstances, 1);
    assert.equal(report.file.application, null);
    assert.deepEqual(report.cartesianPointSample.boundingBox, [[1, 1], [-2, -2], [3, 3]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
