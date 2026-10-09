import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const i = arg.indexOf("=");
  if (i < 0) throw new Error(`Expected --name=value, got ${arg}`);
  return [arg.slice(0, i).replace(/^--/, ""), arg.slice(i + 1)];
}));
if (!args.input) throw new Error("Usage: node scripts/inspect-p25-01-step.mjs --input=<path-to-step-or-stp> --output=<json>");
const input = resolve(args.input);
if (![".step", ".stp"].includes(extname(input).toLowerCase())) throw new Error("Input must have a .step or .stp extension");
const bytes = await readFile(input);
const text = bytes.toString("latin1");
const hash = createHash("sha256").update(bytes).digest("hex");
const entities = [...text.matchAll(/^\s*#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/gm)].map(([, id, type]) => ({ id: Number(id), type }));
const counts = Object.fromEntries([...new Set(entities.map((entity) => entity.type))].sort().map((type) => [type, entities.filter((entity) => entity.type === type).length]));
const pointValues = [...text.matchAll(/CARTESIAN_POINT\s*\([^;]*?\(\s*([-+0-9.E]+)\s*,\s*([-+0-9.E]+)\s*,\s*([-+0-9.E]+)\s*\)/g)].map(([, x, y, z]) => [Number(x), Number(y), Number(z)]).filter((point) => point.every(Number.isFinite));
const bbox = pointValues.length ? pointValues.reduce((box, point) => point.map((value, axis) => [Math.min(box[axis][0], value), Math.max(box[axis][1], value)]), [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]]) : null;
const fileNameBody = text.match(/FILE_NAME\s*\((.*?)\);/s)?.[1] ?? "";
const fileNameFields = [...fileNameBody.matchAll(/'([^']*)'/g)].map((match) => match[1]);
const schema = text.match(/FILE_SCHEMA\s*\(\(\s*'([^']+)'/i)?.[1] ?? null;
const output = resolve(args.output ?? `docs/evidence/plan2/P25-01/text-reference-${hash.slice(0, 16)}.json`);
const report = {
  schemaVersion: 1,
  task: "P25-01",
  referenceKind: "step-part21-lexical-diagnostic",
  independentCadReference: false,
  reason: "A lexical scan is reproducible structural evidence, but it is not an independent CAD read or manual geometry reference.",
  input: { sha256: hash, sizeBytes: bytes.length, sourcePathRecorded: false },
  file: { validIsoHeader: /^ISO-10303-21;/.test(text), validIsoFooter: /END-ISO-10303-21;\s*$/.test(text), schema, application: fileNameFields[5] ?? null, timestamp: fileNameFields[1] ?? null },
  entityCounts: { total: entities.length, uniqueIds: new Set(entities.map((entity) => entity.id)).size, products: counts.PRODUCT ?? 0, productDefinitions: counts.PRODUCT_DEFINITION ?? 0, assemblyInstances: counts.NEXT_ASSEMBLY_USAGE_OCCURRENCE ?? 0, contextDependentShapeRepresentations: counts.CONTEXT_DEPENDENT_SHAPE_REPRESENTATION ?? 0, manifoldSolidBreps: counts.MANIFOLD_SOLID_BREP ?? 0, ...counts },
  cartesianPointSample: { count: pointValues.length, unitsInferred: "unknown; lexical scan does not infer STEP units", boundingBox: bbox },
  limitations: ["No independent CAD application was available in this environment.", "No member centerlines, instance transforms, section properties, connections, or ignored candidates are asserted.", "The lexical counts must not be used as a CAD geometry acceptance result."],
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ output, sha256: hash, status: "partial-reference-only", entityCount: entities.length }, null, 2)}\n`);
