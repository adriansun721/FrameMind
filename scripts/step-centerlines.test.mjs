import test from "node:test";
import assert from "node:assert/strict";
import { parseRecords, parseStepIntermediate } from "./step-intermediate.mjs";
import { extractStepCenterlines } from "./step-centerlines.mjs";
import { prismStep } from "./fixtures/p25-04-prism.mjs";
import { semicircleStep } from "./fixtures/p25-04-semicircle.mjs";
test("analytic box uses physical endpoints, not LINE vector parameter scale", () => {
  const result = parseStepIntermediate(Buffer.from(prismStep())).state.engineeringGeometry;
  assert.equal(result.centerlines.length, 1);
  assert.equal(result.centerlines[0].lengthM, 1);
  assert.deepEqual(result.centerlines[0].start, [0, 0, 0]);
  assert.deepEqual(result.centerlines[0].end, [0, 0, 1]);
  assert.equal(result.centerlines[0].endSections[0].length, 4);
});
test("tapered geometry is blocked instead of declared constant section", () => {
  const result = parseStepIntermediate(Buffer.from(prismStep(true))).state.engineeringGeometry;
  assert.equal(result.centerlines.length, 0); assert.equal(result.issues[0].severity, "blocking");
});
test("unverified curved boundaries are blocked but keep instance location evidence", () => {
  const records = parseRecords(prismStep());
  const curve = records.find((r) => r.type === "LINE");
  curve.type = "CIRCLE";
  const result = extractStepCenterlines(records, { explicit: true, lengthToM: .001 }, []);
  assert.equal(result.centerlines.length, 0);
  assert.equal(result.solidInstances.length, 1);
  assert.deepEqual(result.solidInstances[0].bounds, { min: [-.05, -.05, 0], max: [.05, .05, 1] });
  assert.equal(result.issues[0].severity, "blocking");
});
test("a semicircle with symmetric vertices cannot masquerade as a centroidal axis", () => {
  const result = parseStepIntermediate(Buffer.from(semicircleStep())).state.engineeringGeometry;
  assert.equal(result.centerlines.length, 0);
  assert.equal(result.issues[0].severity, "blocking");
  assert.ok(result.definitions[0].vertexBounds);
  assert.equal(result.solidInstances.length, 1);
});
test("an open cap loop cannot prove a symmetric section from its vertices", () => {
  const records = parseRecords(prismStep());
  const loop = records.find((r) => r.type === "EDGE_LOOP");
  loop.args[1] = loop.args[1].replace(/,#\d+\)$/, ")");
  const result = extractStepCenterlines(records, { explicit: true, lengthToM: .001 }, []);
  assert.equal(result.centerlines.length, 0);
  assert.equal(result.issues[0].severity, "blocking");
});
