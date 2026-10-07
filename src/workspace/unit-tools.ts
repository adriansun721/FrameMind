import { CANONICAL_UNITS, convertQuantity, requireUnitPreset, UNIT_CONTRACT, unitDimension, unitPresentation, type QuantityDimension, type UnitPresetId } from "../domain/units";

const FIELD_DIMENSIONS: Record<string, QuantityDimension> = {
  bandHz: "frequency", frequencyHz: "frequency", absoluteRmsTolerance: "length", absoluteVarianceTolerance: "area", absolutePsdTolerance: "displacementPSD",
  additionalMassKg: "mass", structuralMassKg: "mass", additionalLineMassKgM: "lineMass", massPerLengthKgM: "lineMass", lengthM: "length",
  rootRadiusM: "length", width: "length", height: "length", diameter: "length", thickness: "length", webThickness: "length", flangeThickness: "length",
  position: "length", endPosition: "length", origin: "length", xSpans: "length", ySpans: "length", storeyHeights: "length", length: "length", tolerance: "length", distance: "length", targetPosition: "length",
  displacement: "length", displacementDelta: "length", rotation: "rotation", rotationDelta: "rotation", rotationDegrees: "orientation",
  force: "force", reaction: "force", reactionDelta: "force", totalForce: "force", totalWeightKN: "force", weightKN: "force", globalForce: "force", massKg: "mass", area: "area",
  moment: "moment", reactionMoment: "moment", reactionMomentDelta: "moment",
  intensity: "distributedForce", gravity: "acceleration", elasticModulusGPa: "modulus", densityKgM3: "density",
  areaM2: "area", secondMomentYM4: "inertia", secondMomentZM4: "inertia", torsionalConstantM4: "inertia", totalMassKg: "mass",
};

export function toolFieldDimension(field: string): QuantityDimension | undefined {
  const parts = field.split(".");
  if (parts[0] === "localEndForces") return Number(parts.at(-1)) < 3 ? "force" : "moment";
  return parts.map((part) => FIELD_DIMENSIONS[part]).find(Boolean);
}

function isExplicitPsd(value: Record<string, unknown>): boolean {
  return ["force", "acceleration"].includes(value.quantity as string) && Boolean(value.sidedness && value.frequencyUnit);
}

/** Converts declared engineering fields, leaving IDs, counts, coefficients and provenance intact. */
export function convertToolQuantities(value: unknown, convert: (n: number, dimension: QuantityDimension) => number, dimension?: QuantityDimension): unknown {
  if (typeof value === "number") return dimension ? convert(value, dimension) : value;
  if (Array.isArray(value)) return value.map((item) => convertToolQuantities(item, convert, dimension));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (isExplicitPsd(record)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (["assumptions", "solver", "service", "provenance", "parameterBasis", "catalogBasis", "basis", "process", "randomBasis", "frozenRandomSettings", "inputSpectrum"].includes(key)) { result[key] = child; continue; }
    if (["localEndForces", "startEndForces", "endEndForces", "startDelta", "endDelta"].includes(key)) {
      const forces = (v: unknown): unknown => Array.isArray(v) ? v.map((n, i) => typeof n === "number" ? convert(n, i % 6 < 3 ? "force" : "moment") : n)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, a]) => [k, forces(a)])) : v;
      result[key] = forces(child); continue;
    }
    const explicit = key === "rms" && typeof record.rmsUnit === "string" ? unitDimension(record.rmsUnit) : key === "variance" && record.varianceUnit === "m²" ? "area" : ["value", "delta"].includes(key) && typeof record.unit === "string" ? unitDimension(record.unit)
      : ["min", "max", "equals"].includes(key) && typeof record.field === "string" ? toolFieldDimension(record.field) : undefined;
    result[key] = convertToolQuantities(child, convert, (key === "density" && typeof record.densityUnit === "string" ? unitDimension(record.densityUnit) : undefined) ?? explicit ?? toolFieldDimension(key) ?? dimension);
  }
  return result;
}

export function normalizeToolUnits(input: Record<string, unknown>, toolName?: string): { input: Record<string, unknown>; outputPreset?: UnitPresetId } {
  const { inputUnits, outputUnitPreset, ...args } = input;
  const outputPreset = outputUnitPreset === undefined ? undefined : requireUnitPreset(outputUnitPreset);
  if (inputUnits === undefined) return { input: args, outputPreset };
  if (!inputUnits || typeof inputUnits !== "object" || Array.isArray(inputUnits)) throw new Error("inputUnits 必须明确登记各量纲单位");
  const declared = inputUnits as Record<string, unknown>;
  for (const [dimension, unit] of Object.entries(declared)) {
    if (!Object.hasOwn(CANONICAL_UNITS, dimension) || typeof unit !== "string") throw new Error("inputUnits 含未登记的量纲或单位");
    convertQuantity(1, dimension as QuantityDimension, unit, CANONICAL_UNITS[dimension as QuantityDimension]);
  }
  const canonicalize = (value: number, dimension: QuantityDimension) => convertQuantity(value, dimension,
    declared[dimension] as string ?? CANONICAL_UNITS[dimension], CANONICAL_UNITS[dimension]);
  const converted = convertToolQuantities(args, canonicalize) as Record<string, unknown>;
  if (toolName && ["create_node", "update_node", "create_nodes", "update_nodes"].includes(toolName)) {
    const flat = (entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.entries(record).map(([key, value]) => [key,
        ["x", "y", "z"].includes(key) && typeof value === "number" ? canonicalize(value, "length") : value]));
    };
    if (toolName.endsWith("nodes")) {
      const key = toolName === "create_nodes" ? "nodes" : "updates";
      if (Array.isArray(converted[key])) converted[key] = converted[key].map(flat);
    } else return { input: flat(converted) as Record<string, unknown>, outputPreset };
  }
  return { input: converted, outputPreset };
}

export function presentToolData(data: unknown, preset: UnitPresetId): unknown {
  const u = unitPresentation(preset);
  const converted = convertToolQuantities(data, (v, d) => u.value(v, CANONICAL_UNITS[d]));
  const labels = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(labels);
    if (!value || typeof value !== "object" || isExplicitPsd(value as Record<string, unknown>)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ["assumptions", "solver", "service", "provenance", "parameterBasis", "catalogBasis", "basis", "process", "randomBasis", "frozenRandomSettings", "inputSpectrum"].includes(key) ? child
        : (["unit", "units", "rmsUnit", "varianceUnit", "densityUnit", "frequencyUnit"].includes(key)) && typeof child === "string" && Object.values(CANONICAL_UNITS).includes(child as never) ? u.unit(child)
          : key === "units" && child && typeof child === "object" ? Object.fromEntries(Object.entries(child).map(([k, v]) => [k, typeof v === "string" && Object.values(CANONICAL_UNITS).includes(v as never) ? u.unit(v) : v])) : labels(child)]));
  };
  const presented = labels(converted);
  return { ...(presented && typeof presented === "object" && !Array.isArray(presented) ? presented : { items: presented }), displayUnitPreset: preset, quantityUnits: u.units, storageContract: UNIT_CONTRACT.canonical };
}
