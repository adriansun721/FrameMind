import { createHash } from "node:crypto";

export const INTERMEDIATE_SCHEMA_VERSION = 2;

const COMPLEX_TYPE_RE = /\b([A-Z][A-Z0-9_]*)\s*\(/g;
const NUMBER_RE = /[-+]?(?:\d+\.?(?:\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/g;
const UNSUPPORTED_TYPES = new Set([
  "B_SPLINE_CURVE", "B_SPLINE_CURVE_WITH_KNOTS", "BEZIER_CURVE", "RATIONAL_B_SPLINE_CURVE",
  "B_SPLINE_SURFACE", "B_SPLINE_SURFACE_WITH_KNOTS", "BEZIER_SURFACE", "RATIONAL_B_SPLINE_SURFACE",
  "TOROIDAL_SURFACE", "SPHERICAL_SURFACE", "DEGENERATE_TOROIDAL_SURFACE",
]);

export const STEP_READER_INFO = Object.freeze({ name: "FrameMind STEP Part 21 reader", version: "2.0.0", build: "framemind-step-reader-2", license: "MIT", runtime: "bundled" });

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const round = (value, digits = 12) => {
  const scale = 10 ** digits;
  const result = Math.round(finite(value) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
};
const vectorLength = (value) => Math.hypot(value[0], value[1], value[2]);
const normalize = (value, fallback = [1, 0, 0]) => {
  const length = vectorLength(value);
  return length > 1e-15 ? value.map((part) => part / length) : [...fallback];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cleanVector = (value) => value.map((part) => round(part));
const cleanMatrix = (matrix) => matrix.map((row) => row.map((value) => round(value)));
const identityMatrix = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const multiplyMatrices = (left, right) => cleanMatrix(Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => left[row].reduce((sum, value, index) => sum + value * right[index][column], 0))));
const applyPoint = (matrix, point) => cleanVector([matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2] + matrix[0][3], matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2] + matrix[1][3], matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2] + matrix[2][3]]);
const applyDirection = (matrix, direction) => cleanVector(normalize([matrix[0][0] * direction[0] + matrix[0][1] * direction[1] + matrix[0][2] * direction[2], matrix[1][0] * direction[0] + matrix[1][1] * direction[1] + matrix[1][2] * direction[2], matrix[2][0] * direction[0] + matrix[2][1] * direction[1] + matrix[2][2] * direction[2]]));

function decodeStepString(value) {
  return value
    .replace(/^'|'$/g, "")
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex) => {
      let result = "";
      for (let index = 0; index + 3 < hex.length; index += 4) result += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
      return result;
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0, depth = 0, quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (value[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1; }
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function matchingClose(value, openIndex) {
  let depth = 0, quoted = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (value[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) return index;
    }
  }
  return value.length - 1;
}

function parseRecords(text) {
  const dataStart = text.search(/\bDATA\s*;/i);
  const dataEnd = text.search(/\bEND-ISO-10303-21\s*;/i);
  if (dataStart < 0 || dataEnd < 0 || dataEnd <= dataStart) throw new Error("STEP 文档缺少完整 DATA 段");
  const dataOffset = dataStart + text.slice(dataStart).indexOf(";") + 1;
  const data = text.slice(dataOffset, dataEnd);
  const records = [];
  let start = 0, depth = 0, quoted = false, line = text.slice(0, dataOffset).split(/\r?\n/).length, recordLine = line;
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    if (char === "'") {
      if (data[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === ";" && depth === 0) {
        const source = data.slice(start, index + 1).trim();
        const match = source.match(/^#(\d+)\s*=\s*([\s\S]*?)\s*;$/);
        if (match) {
          const body = match[2].trim();
          const types = [];
          for (const typeMatch of body.matchAll(COMPLEX_TYPE_RE)) if (!types.includes(typeMatch[1].toUpperCase())) types.push(typeMatch[1].toUpperCase());
          const firstType = types[0] ?? "UNKNOWN";
          const firstOpen = body.search(/\(/);
          records.push({ id: Number(match[1]), body, type: firstType, types, args: firstOpen >= 0 ? splitTopLevel(body.slice(firstOpen + 1, matchingClose(body, firstOpen))) : [], line: recordLine });
        }
        start = index + 1;
        recordLine = line;
      }
    }
    if (char === "\n") line += 1;
  }
  return records;
}

const refs = (value) => [...value.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
const ref = (value) => value.match(/^#(\d+)$/)?.[1] ? Number(value.match(/^#(\d+)$/)[1]) : undefined;
const numbers = (value) => [...value.matchAll(NUMBER_RE)].map((match) => Number(match[0]));
const stringValue = (value) => value?.match(/^'(.*)'$/s) ? decodeStepString(value) : undefined;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export const hashAudit = (value) => digest(value);

function matrixFromPlacement(placement, pointMap, directionMap) {
  if (!placement) return { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const [locationRef, axisRef, refDirectionRef] = placement.args.slice(1).map(ref);
  const origin = pointMap.get(locationRef) ?? [0, 0, 0];
  const z = normalize(directionMap.get(axisRef) ?? [0, 0, 1], [0, 0, 1]);
  const rawX = normalize(directionMap.get(refDirectionRef) ?? [1, 0, 0], [1, 0, 0]);
  const x = normalize(rawX.map((value, index) => value - z[index] * dot(rawX, z)), [1, 0, 0]);
  const y = normalize(cross(z, x), [0, 1, 0]);
  return { origin, x, y, z };
}

function matrixForTransform(source, target) {
  const rotation = [target.x.map((_, column) => dot(target.x, source[["x", "y", "z"][column]])), target.y.map((_, column) => dot(target.y, source[["x", "y", "z"][column]])), target.z.map((_, column) => dot(target.z, source[["x", "y", "z"][column]]))];
  const origin = [dot(target.x, source.origin.map((value, i) => value - target.origin[i])), dot(target.y, source.origin.map((value, i) => value - target.origin[i])), dot(target.z, source.origin.map((value, i) => value - target.origin[i]))];
  return cleanMatrix([[rotation[0][0], rotation[0][1], rotation[0][2], origin[0]], [rotation[1][0], rotation[1][1], rotation[1][2], origin[1]], [rotation[2][0], rotation[2][1], rotation[2][2], origin[2]], [0, 0, 0, 1]]);
}

function detectUnits(records, text) {
  const unitText = records.filter((record) => record.types.some((type) => ["SI_UNIT", "CONVERSION_BASED_UNIT", "LENGTH_UNIT"].includes(type))).map((record) => record.body).join(" ");
  const prefix = unitText.match(/SI_UNIT\s*\(\s*\.([A-Z]+)\.\s*,\s*\.METRE\./i)?.[1]?.toUpperCase();
  const scaleByPrefix = { MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3, MICRO: 1e-6, NANO: 1e-9 };
  const lengthToM = prefix ? scaleByPrefix[prefix] ?? 1 : /\bMILLI(?:METRE|METER)/i.test(text) ? 1e-3 : 1;
  const sourceLength = prefix ? `${prefix.toLowerCase()}metre` : "unknown";
  return { sourceLength, length: "m", lengthToM, areaToM2: lengthToM ** 2, inertiaToM4: lengthToM ** 4, torsionToM4: lengthToM ** 4, explicit: Boolean(prefix) };
}

function summarizeAi(state) {
  return JSON.stringify({ schemaVersion: state.schemaVersion, units: state.units, products: state.products.map(({ id, name, definitionId }) => ({ id, name, definitionId })), instances: state.instances.map(({ id, parentDefinitionId, childDefinitionId, transform, globalTransform }) => ({ id, parentDefinitionId, childDefinitionId, transform, globalTransform })), entities: state.diagnostics.entityCount, solids: state.brepSummaries.map(({ id, faceCount, surfaceKinds }) => ({ id, faceCount, surfaceKinds })), candidates: { definitions: state.geometryCandidates.length, instances: state.instanceGeometryCandidates.length, nodes: state.candidateNodes.length, members: state.candidateMembers.length, sectionBasis: state.sectionBasis.length }, anomalies: state.anomalies, warnings: state.warnings, ignoredEntities: state.ignoredEntities.map(({ id, type, reason }) => ({ id, type, reason })) });
}

export function parseStepIntermediate(bytes, options = {}) {
  const text = Buffer.from(bytes).toString("utf8");
  const records = parseRecords(text);
  const byId = new Map(records.map((record) => [record.id, record]));
  const units = detectUnits(records, text);
  const parameters = { coordinateSystem: "global-right-handed", lengthUnit: "m", ...(options.parameters ?? {}) };
  const pointMap = new Map(), directionMap = new Map(), placementMap = new Map(), vectorMap = new Map();
  for (const record of records) {
    if (record.type === "CARTESIAN_POINT") { const values = numbers(record.args.at(-1) ?? ""); if (values.length >= 3) pointMap.set(record.id, values.slice(-3)); }
    if (record.type === "DIRECTION") { const values = numbers(record.args.at(-1) ?? ""); if (values.length >= 3) directionMap.set(record.id, normalize(values.slice(-3))); }
    if (record.type === "AXIS2_PLACEMENT_3D") placementMap.set(record.id, matrixFromPlacement(record, pointMap, directionMap));
    if (record.type === "VECTOR") { const directionId = ref(record.args[1]); vectorMap.set(record.id, { directionId, magnitude: finite(numbers(record.args[2] ?? "")[0]) }); }
  }
  // Placements can occur before their referenced points. Re-evaluate once all primitive maps exist.
  for (const record of records) if (record.type === "AXIS2_PLACEMENT_3D") placementMap.set(record.id, matrixFromPlacement(record, pointMap, directionMap));
  const entitySummaries = records.map((record) => ({ id: record.id, type: record.type, line: record.line, ...(record.types.length > 1 ? { types: record.types } : {}) })).sort((a, b) => a.id - b.id);
  const products = records.filter((record) => record.type === "PRODUCT").map((record) => ({ id: record.id, name: stringValue(record.args[0]) ?? `product-${record.id}`, description: stringValue(record.args[1]) ?? "", definitionId: refs(record.args.at(-1) ?? "")[0] ?? null, sourceEntityIds: [record.id] })).sort((a, b) => a.id - b.id);
  const definitions = new Map(records.filter((record) => record.type === "PRODUCT_DEFINITION").map((record) => [record.id, refs(record.args[2] ?? "")[0] ?? null]));
  const formations = new Map(records.filter((record) => record.type === "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE").map((record) => [record.id, refs(record.args[2] ?? "")[0] ?? null]));
  const definitionToProduct = new Map();
  for (const [definitionId, formationId] of definitions) {
    const productId = formations.get(formationId);
    if (productId !== undefined) definitionToProduct.set(definitionId, productId);
  }
  const shapeToDefinition = new Map(records.filter((record) => record.type === "PRODUCT_DEFINITION_SHAPE").map((record) => [record.id, refs(record.args.at(-1) ?? "")[0] ?? null]));
  const relations = new Map();
  for (const record of records.filter((candidate) => candidate.types.includes("REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"))) {
    const references = refs(record.body);
    const transformId = references.at(-1);
    const representations = references.filter((id) => byId.get(id)?.type?.endsWith("REPRESENTATION"));
    if (representations.length >= 2) relations.set(record.id, { sourceRepresentationId: representations[0], targetRepresentationId: representations[1], transformId });
  }
  const instances = records.filter((record) => record.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE").map((record) => {
    const references = refs(record.body), parentDefinitionId = references.at(-2) ?? null, childDefinitionId = references.at(-1) ?? null;
    const relation = records.filter((candidate) => candidate.type === "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION").map((candidate) => ({ candidate, refs: refs(candidate.body) })).find(({ refs: candidateRefs }) => shapeToDefinition.get(candidateRefs[1]) === record.id);
    const relationValue = relation ? relations.get(relation.refs[0]) : undefined;
    const transformation = relationValue ? byId.get(relationValue.transformId) : undefined;
    const placementRefs = transformation ? refs(transformation.body).filter((id) => byId.get(id)?.type === "AXIS2_PLACEMENT_3D") : [];
    const sourcePlacement = placementMap.get(placementRefs[0]);
    const targetPlacement = placementMap.get(placementRefs[1]);
    const transform = sourcePlacement && targetPlacement ? matrixForTransform(sourcePlacement, targetPlacement).map((row, rowIndex) => rowIndex === 3 ? row : row.map((value, columnIndex) => columnIndex === 3 ? round(value * units.lengthToM) : value)) : identityMatrix();
    return { id: record.id, name: stringValue(record.args[0]) ?? `instance-${record.id}`, parentDefinitionId, childDefinitionId, parentProductId: definitionToProduct.get(parentDefinitionId) ?? null, childProductId: definitionToProduct.get(childDefinitionId) ?? null, transform, globalTransform: transform, sourceEntityIds: [record.id, ...(relation ? [relation.candidate.id] : []), ...(transformation ? [transformation.id] : [])] };
  }).sort((a, b) => a.id - b.id);
  const globalByChildDefinition = new Map();
  for (const instance of instances) {
    const parentTransform = globalByChildDefinition.get(instance.parentDefinitionId);
    instance.globalTransform = parentTransform ? multiplyMatrices(parentTransform, instance.transform) : instance.transform;
    globalByChildDefinition.set(instance.childDefinitionId, instance.globalTransform);
  }
  const assemblyTree = instances.map((instance) => ({ instanceId: instance.id, parentDefinitionId: instance.parentDefinitionId, childDefinitionId: instance.childDefinitionId, parentProductId: instance.parentProductId, childProductId: instance.childProductId, globalTransform: instance.globalTransform }));
  const brepSummaries = records.filter((record) => record.type === "MANIFOLD_SOLID_BREP").map((record) => {
    const shellId = refs(record.args.at(-1) ?? "")[0];
    const shell = byId.get(shellId);
    const faceIds = shell ? refs(shell.args.at(-1) ?? "") : [];
    const surfaceKinds = faceIds.map((faceId) => { const face = byId.get(faceId); const surfaceId = face ? refs(face.args[2] ?? "")[0] : undefined; return byId.get(surfaceId)?.type; }).filter(Boolean).sort();
    return { id: record.id, shellId: shellId ?? null, faceCount: faceIds.length, surfaceKinds: [...new Set(surfaceKinds)], sourceEntityIds: [record.id, ...(shellId ? [shellId] : []), ...faceIds] };
  }).sort((a, b) => a.id - b.id);
  const solidLineOwners = new Map();
  for (const summary of brepSummaries) {
    const visited = new Set();
    const visit = (id) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      const record = byId.get(id);
      if (!record) return;
      if (record.type === "LINE") solidLineOwners.set(id, [...(solidLineOwners.get(id) ?? []), summary.id]);
      for (const childId of refs(record.body)) visit(childId);
    };
    visit(summary.id);
  }
  const shapeRepresentationProducts = new Map();
  for (const record of records.filter((candidate) => candidate.type === "SHAPE_DEFINITION_REPRESENTATION")) {
    const shapeDefinitionId = refs(record.args[0] ?? "")[0];
    const shapeRepresentationId = refs(record.args[1] ?? "")[0];
    const definitionId = shapeToDefinition.get(shapeDefinitionId);
    const productId = definitionToProduct.get(definitionId);
    if (shapeRepresentationId && productId !== undefined) shapeRepresentationProducts.set(shapeRepresentationId, productId);
  }
  const solidProducts = new Map();
  for (const relation of records.filter((candidate) => candidate.types.includes("REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"))) {
    const relationRefs = refs(relation.body);
    const representationIds = relationRefs.filter((id) => byId.get(id)?.type?.endsWith("REPRESENTATION"));
    const productId = shapeRepresentationProducts.get(representationIds[0]);
    const advancedRepresentation = byId.get(representationIds[1]);
    if (productId !== undefined && advancedRepresentation) for (const solidId of refs(advancedRepresentation.body)) if (byId.get(solidId)?.type === "MANIFOLD_SOLID_BREP") solidProducts.set(solidId, productId);
  }
  const geometryCandidates = records.filter((record) => record.type === "LINE").map((record) => {
    const pointId = ref(record.args[1]), vectorId = ref(record.args[2]), point = pointMap.get(pointId) ?? [0, 0, 0], vector = vectorMap.get(vectorId), direction = vector ? directionMap.get(vector.directionId) ?? [1, 0, 0] : [1, 0, 0];
    const solidIds = [...new Set(solidLineOwners.get(record.id) ?? [])].sort((a, b) => a - b);
    const productIds = [...new Set(solidIds.map((solidId) => solidProducts.get(solidId)).filter((productId) => productId !== undefined))];
    return { id: `line-${record.id}`, kind: "line", classification: productIds.length ? "unreviewed-brep-edge-line" : "unowned-geometric-line", sourceEntityId: record.id, origin: cleanVector(point.map((value) => value * units.lengthToM)), direction: cleanVector(normalize(direction)), lengthM: vector ? round(vector.magnitude * units.lengthToM) : null, solidIds, productIds, sourceEntityIds: [record.id, ...(pointId ? [pointId] : []), ...(vectorId ? [vectorId] : [])] };
  }).sort((a, b) => a.sourceEntityId - b.sourceEntityId);
  const instanceGeometryCandidates = instances.flatMap((instance) => geometryCandidates.filter((candidate) => candidate.productIds.includes(instance.childProductId)).map((candidate) => ({ ...candidate, id: `${instance.id}:${candidate.id}`, instanceId: instance.id, origin: applyPoint(instance.globalTransform, candidate.origin), direction: applyDirection(instance.globalTransform, candidate.direction), sourceEntityIds: [...candidate.sourceEntityIds, instance.id] })));
  const nodeByKey = new Map();
  const candidateNodes = [];
  const addNode = (position, sourceEntityIds) => {
    const key = `${sourceEntityIds[0]}:${position.map((value) => round(value, 9)).join(",")}`;
    const existing = nodeByKey.get(key);
    if (existing) { existing.sourceEntityIds = [...new Set([...existing.sourceEntityIds, ...sourceEntityIds])].sort((a, b) => a - b); return existing.id; }
    const node = { id: `cad-node-${candidateNodes.length + 1}`, position: cleanVector(position), sourceEntityIds: [...new Set(sourceEntityIds)].sort((a, b) => a - b) };
    nodeByKey.set(key, node); candidateNodes.push(node); return node.id;
  };
  const memberGeometryCandidates = instanceGeometryCandidates.length ? instanceGeometryCandidates : geometryCandidates.map((candidate) => ({ ...candidate, id: `definition:${candidate.id}`, instanceId: null }));
  const candidateMembers = memberGeometryCandidates.map((candidate) => {
    const startNodeId = addNode(candidate.origin, candidate.sourceEntityIds);
    const endPosition = candidate.lengthM === null ? null : candidate.origin.map((value, index) => value + candidate.direction[index] * candidate.lengthM);
    const endNodeId = endPosition ? addNode(endPosition, candidate.sourceEntityIds) : null;
    return { id: `cad-member-${candidate.instanceId ?? "definition"}-${candidate.sourceEntityId}`, kind: "line", classification: candidate.instanceId === null ? "unowned-definition-candidate" : "unreviewed-candidate", instanceId: candidate.instanceId, startNodeId, endNodeId, sourceEntityIds: candidate.sourceEntityIds, sectionBasisId: `section-basis-${candidate.instanceId ?? "definition"}-${candidate.sourceEntityId}` };
  });
  const sectionBasis = candidateMembers.map((member) => ({ id: member.sectionBasisId, status: "unresolved", reason: "STEP 几何未声明工程截面属性，等待后续截面核验", sourceEntityIds: member.sourceEntityIds }));
  const ignoredEntities = records.filter((record) => record.types.some((type) => UNSUPPORTED_TYPES.has(type))).map((record) => ({ id: record.id, type: record.type, reason: "unsupported freeform geometry retained as diagnostic only" })).sort((a, b) => a.id - b.id);
  const warnings = [];
  if (!units.explicit) warnings.push("STEP 长度单位未明确，未按数值大小猜测；使用 metre 作为解析回退");
  if (instances.some((instance) => instance.transform.some((row) => row.some((value) => !Number.isFinite(value))))) warnings.push("部分装配实例变换无法确定");
  if (geometryCandidates.length === 0) warnings.push("未发现可提取的直线候选几何");
  if (instances.length > 0 && instanceGeometryCandidates.length === 0) warnings.push("未能将几何候选关联到装配实例，候选保留在定义坐标系并等待复核");
  if (ignoredEntities.length > 0) warnings.push(`发现 ${ignoredEntities.length} 个不支持的自由曲面实体，已保留为忽略诊断`);
  const anomalies = [
    ...(ignoredEntities.length ? [{ code: "unsupported-freeform-geometry", severity: "blocking", entityIds: ignoredEntities.map((entity) => entity.id) }] : []),
    ...(geometryCandidates.length ? [{ code: "unreviewed-line-candidates", severity: "review", count: geometryCandidates.length, message: "直线仅作为几何候选，未自动确认工程杆件" }] : []),
    ...(sectionBasis.length ? [{ code: "missing-section-basis", severity: "review", count: sectionBasis.length, entityIds: [...new Set(sectionBasis.flatMap((basis) => basis.sourceEntityIds))].sort((a, b) => a - b), message: "直线候选尚未关联截面依据" }] : []),
  ];
  const blockingIssues = [...(ignoredEntities.length ? ["unsupported-freeform-geometry"] : []), ...(!units.explicit ? ["unit-unknown"] : [])];
  const diagnostics = { entityCount: records.length, productCount: products.length, assemblyInstanceCount: instances.length, solidCount: brepSummaries.length, lineCandidateCount: geometryCandidates.length, unsupportedEntityCount: ignoredEntities.length, coordinateSystem: parameters.coordinateSystem, sourceLengthUnit: units.sourceLength, blockingIssues, anomalies };
  const sourceMappings = [
    ...products.map((product) => ({ sourceEntityIds: product.sourceEntityIds, derivedKind: "product", derivedIds: [product.id] })),
    ...instances.map((instance) => ({ sourceEntityIds: instance.sourceEntityIds, derivedKind: "assembly-instance", derivedIds: [instance.id] })),
    ...brepSummaries.map((summary) => ({ sourceEntityIds: summary.sourceEntityIds, derivedKind: "solid-summary", derivedIds: [summary.id] })),
    ...geometryCandidates.map((candidate) => ({ sourceEntityIds: candidate.sourceEntityIds, derivedKind: "geometry-candidate", derivedIds: [candidate.id] })),
    ...instanceGeometryCandidates.map((candidate) => ({ sourceEntityIds: candidate.sourceEntityIds, derivedKind: "instance-geometry-candidate", derivedIds: [candidate.id] })),
    ...candidateNodes.map((node) => ({ sourceEntityIds: node.sourceEntityIds, derivedKind: "candidate-node", derivedIds: [node.id] })),
    ...candidateMembers.map((member) => ({ sourceEntityIds: member.sourceEntityIds, derivedKind: "candidate-member", derivedIds: [member.id, member.sectionBasisId] })),
  ].sort((a, b) => a.sourceEntityIds[0] - b.sourceEntityIds[0]);
  const state = { schemaVersion: INTERMEDIATE_SCHEMA_VERSION, normalization: { coordinateSystem: parameters.coordinateSystem, lengthUnit: parameters.lengthUnit, deterministic: true }, units, unitConversions: { length: { sourceToCanonical: units.lengthToM, canonical: "m" }, area: { sourceToCanonical: units.areaToM2, canonical: "m²" }, secondMoment: { sourceToCanonical: units.inertiaToM4, canonical: "m⁴" }, torsionConstant: { sourceToCanonical: units.torsionToM4, canonical: "m⁴" } }, entities: entitySummaries, products, assemblyTree, instances, brepSummaries, geometryCandidates, instanceGeometryCandidates, candidateNodes, candidateMembers, sectionBasis, sourceMappings, diagnostics, anomalies, warnings, ignoredEntities };
  const geometryHash = digest(state);
  const inputSha256 = options.inputSha256 ?? digest(bytes);
  const audit = { parserVersion: options.parserVersion ?? "framemind-step-reader/2.0.0", inputSha256, parameters };
  return { state, geometryHash, auditHash: digest(audit), audit, aiSummary: summarizeAi(state) };
}

export function canonicalizeIntermediate(value) { return canonical(value); }
