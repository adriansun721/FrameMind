import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const fixture = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('FrameMind P25-03'),'2;1');
FILE_NAME('deterministic.step','2026-10-09T00:00:00',('a'),('b'),'FrameMind','FrameMind','');
FILE_SCHEMA(('AP203'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('origin',(1000.,2000.,3000.));
#2 = DIRECTION('z',(0.,0.,1.));
#3 = DIRECTION('x',(1.,0.,0.));
#4 = AXIS2_PLACEMENT_3D('placement',#1,#2,#3);
#5 = (LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
#10 = PRODUCT('part','Part','',(#11));
#11 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#10,.NOT_KNOWN.);
#12 = PRODUCT_DEFINITION('','',#11,#13);
#13 = DESIGN_CONTEXT('','');
#14 = PRODUCT_DEFINITION_SHAPE('','',#12);
#15 = SHAPE_DEFINITION_REPRESENTATION(#14,#16);
#16 = SHAPE_REPRESENTATION('part',(#17),#18);
#17 = MANIFOLD_SOLID_BREP('solid',#19);
#19 = CLOSED_SHELL('shell',(#20,#21));
#20 = ADVANCED_FACE('face',(),#22,.T.);
#21 = ADVANCED_FACE('face',(),#23,.T.);
#22 = PLANE('plane',#4);
#23 = CYLINDRICAL_SURFACE('cylinder',#4,10.);
#30 = CARTESIAN_POINT('line-start',(0.,0.,0.));
#31 = DIRECTION('line-dir',(1.,0.,0.));
#32 = VECTOR('line-vector',#31,1000.);
#33 = LINE('member-axis',#30,#32);
ENDSEC;
END-ISO-10303-21;
`;

test("P25-03 exports a deterministic, canonical and redacted intermediate state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-p25-03-"));
  try {
    const input = join(directory, "source.step");
    const firstOutput = join(directory, "first.json");
    const secondOutput = join(directory, "second.json");
    await writeFile(input, fixture);
    for (const output of [firstOutput, secondOutput]) {
      const result = spawnSync(process.execPath, ["scripts/run-p25-03-step.mjs", `--input=${input}`, `--output=${output}`, "--parameters={\"coordinateSystem\":\"global-right-handed\",\"lengthUnit\":\"m\"}"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const first = JSON.parse(await readFile(firstOutput, "utf8"));
    const second = JSON.parse(await readFile(secondOutput, "utf8"));
    assert.equal(first.task, "P25-03");
    assert.equal(first.acceptance.deterministic, true);
    assert.equal(first.intermediate.geometryHash, second.intermediate.geometryHash);
    assert.notEqual(first.intermediate.auditHash, second.intermediate.auditHash);
    assert.equal(first.intermediate.state.units.length, "m");
    assert.deepEqual(first.intermediate.state.instances, []);
    assert.equal(first.intermediate.state.geometryCandidates[0].origin[0], 0);
    assert.equal(first.intermediate.state.brepSummaries[0].faceCount, 2);
    assert.equal(JSON.stringify(first).includes(input), false);
    assert.equal(first.aiSummary.includes(input), false);
    assert.equal(first.aiSummary.includes("BREP"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
