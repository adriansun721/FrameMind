import { CANONICAL_UNITS, convertQuantity, requireUnitPreset, UNIT_CONTRACT, unitDimension, unitPresentation, type QuantityDimension, type UnitPresetId } from "../domain/units";

const FIELD_DIMENSIONS: Record<string, QuantityDimension> = {
  position: "length", endPosition: "length", origin: "length", xSpans: "length", ySpans: "length", storeyHeights: "length", length: "length",
  displacement: "length", displacementDelta: "length", rotation: "rotation", rotationDelta: "rotation", rotationDegrees: "orientation",
  force: "force", reaction: "force", reactionDelta: "force", totalForce: "force", totalWeightKN: "force",
  moment: "moment", reactionMoment: "moment", reactionMomentDelta: "moment",
  intensity: "distributedForce", gravity: "acceleration", elasticModulusGPa: "modulus", densityKgM3: "density",
  areaM2: "area", secondMomentYM4: "inertia", secondMomentZM4: "inertia", torsionalConstantM4: "inertia", totalMassKg: "mass",
};

export function toolFieldDimension(field: string): QuantityDimension | undefined {
  const parts = field.split(".");
  if (parts[0] === "localEndForces") return Number(parts.at(-1)) < 3 ? "force" : "moment";
  return parts.map((part) => FIELD_DIMENSIONS[part]).find(Boolean);
}

/** Converts declared engineering fields, leaving IDs, counts, coefficients and provenance intact. */
export function convertToolQuantities(value: unknown, convert: (n: number, dimension: QuantityDimension) => number, dimension?: QuantityDimension): unknown {
  if (typeof value === "number") return dimension ? convert(value, dimension) : value;
  if (Array.isArray(value)) return value.map((item) => convertToolQuantities(item, convert, dimension));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (["assumptions", "solver", "service", "provenance", "basis", "process"].includes(key)) { result[key] = child; continue; }
    if (["localEndForces", "startEndForces", "endEndForces"].includes(key)) {
      const forces = (v: unknown): unknown => Array.isArray(v) ? v.map((n, i) => typeof n === "number" ? convert(n, i % 6 < 3 ? "force" : "moment") : n)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, a]) => [k, forces(a)])) : v;
      result[key] = forces(child); continue;
    }
    const explicit = ["value", "delta"].includes(key) && typeof record.unit === "string" ? unitDimension(record.unit)
      : ["min", "max", "equals"].includes(key) && typeof record.field === "string" ? toolFieldDimension(record.field) : undefined;
    result[key] = convertToolQuantities(child, convert, explicit ?? toolFieldDimension(key) ?? dimension);
  }
  return result;
}

export function normalizeToolUnits(input: Record<string, unknown>): { input: Record<string, unknown>; outputPreset?: UnitPresetId } {
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
  return { input: converted, outputPreset };
}

export function presentToolData(data: unknown, preset: UnitPresetId): unknown {
  const u = unitPresentation(preset);
  const converted = convertToolQuantities(data, (v, d) => u.value(v, CANONICAL_UNITS[d]));
  const labels = (value: unknown): unknown => Array.isArray(value) ? value.map(labels) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ["assumptions", "solver", "service", "provenance", "basis", "process"].includes(key) ? child
        : (key === "unit" || key === "units") && typeof child === "string" && Object.values(CANONICAL_UNITS).includes(child as never) ? u.unit(child)
          : key === "units" && child && typeof child === "object" ? Object.fromEntries(Object.entries(child).map(([k, v]) => [k, typeof v === "string" && Object.values(CANONICAL_UNITS).includes(v as never) ? u.unit(v) : v])) : labels(child)])) : value;
  const presented = labels(converted);
  return { ...(presented && typeof presented === "object" && !Array.isArray(presented) ? presented : { items: presented }), displayUnitPreset: preset, quantityUnits: u.units, storageContract: UNIT_CONTRACT.canonical };
}
