/** Numeric storage and solver units never follow a display preference. */
export const CANONICAL_UNITS = {
  length: "m", force: "kN", moment: "kN·m", distributedForce: "kN/m",
  modulus: "GPa", density: "kg/m³", area: "m²", inertia: "m⁴",
  orientation: "°", rotation: "rad", acceleration: "m/s²", mass: "kg",
  frequency: "Hz", displacementPSD: "m²/Hz", accelerationPSD: "(m/s²)²/Hz",
  forcePSD: "kN²/Hz", dimensionless: "无",
} as const;
export type QuantityDimension = keyof typeof CANONICAL_UNITS;
export const UNIT_PRESETS = {
  "m-kN": { label: "m · kN · GPa", units: { ...CANONICAL_UNITS } },
  "mm-N": { label: "mm · N · MPa", units: { ...CANONICAL_UNITS, length: "mm", force: "N", moment: "N·mm", distributedForce: "N/mm", modulus: "MPa", density: "kg/mm³", area: "mm²", inertia: "mm⁴", acceleration: "mm/s²", displacementPSD: "mm²/Hz", accelerationPSD: "(mm/s²)²/Hz", forcePSD: "N²/Hz" } },
  "mm-kN": { label: "mm · kN · MPa", units: { ...CANONICAL_UNITS, length: "mm", moment: "kN·mm", distributedForce: "kN/mm", modulus: "MPa", density: "kg/mm³", area: "mm²", inertia: "mm⁴", acceleration: "mm/s²", displacementPSD: "mm²/Hz", accelerationPSD: "(mm/s²)²/Hz" } },
} as const;
export type UnitPresetId = keyof typeof UNIT_PRESETS;
// Factors multiply a value to obtain that dimension's canonical numeric value.
const UNIT_FACTORS: Record<QuantityDimension, Readonly<Record<string, number>>> = {
  length: { m: 1, mm: 1e-3, cm: 1e-2 }, force: { kN: 1, N: 1e-3 },
  moment: { "kN·m": 1, "N·m": 1e-3, "N·mm": 1e-6, "kN·mm": 1e-3 },
  distributedForce: { "kN/m": 1, "N/m": 1e-3, "N/mm": 1, "kN/mm": 1e3 },
  modulus: { GPa: 1, MPa: 1e-3, Pa: 1e-9, "kN/m²": 1e-6, "N/mm²": 1e-3 },
  density: { "kg/m³": 1, "kg/mm³": 1e9, "t/m³": 1e3 },
  area: { "m²": 1, "mm²": 1e-6, "cm²": 1e-4 },
  inertia: { "m⁴": 1, "mm⁴": 1e-12, "cm⁴": 1e-8 },
  orientation: { "°": 1, rad: 180 / Math.PI }, rotation: { rad: 1, "°": Math.PI / 180 },
  acceleration: { "m/s²": 1, "mm/s²": 1e-3 }, mass: { kg: 1, t: 1e3 },
  frequency: { Hz: 1, "rad/s": 1 / (2 * Math.PI) },
  displacementPSD: { "m²/Hz": 1, "mm²/Hz": 1e-6 },
  accelerationPSD: { "(m/s²)²/Hz": 1, "(mm/s²)²/Hz": 1e-6 },
  forcePSD: { "kN²/Hz": 1, "N²/Hz": 1e-6 }, dimensionless: { "无": 1, "1": 1 },
};
export function requireUnitPreset(value: unknown): UnitPresetId {
  if (typeof value !== "string" || !Object.hasOwn(UNIT_PRESETS, value)) throw new Error("单位预设无效；请选择 m-kN、mm-N 或 mm-kN");
  return value as UnitPresetId;
}
export function convertQuantity(value: number, dimension: QuantityDimension, from: string, to: string): number {
  const factors = UNIT_FACTORS[dimension];
  if (!factors || !Object.hasOwn(factors, from) || !Object.hasOwn(factors, to)) throw new Error(`请明确 ${dimension} 的有效单位，不能根据数值猜测单位`);
  if (!Number.isFinite(value)) throw new Error("单位转换需要有限数值");
  const converted = from === to ? value : value * (factors[from] / factors[to]);
  if (!Number.isFinite(converted) || value !== 0 && converted === 0) throw new Error("单位转换超出有限数值精度范围");
  return converted;
}
export function unitDimension(unit: string): QuantityDimension {
  const dimension = (Object.keys(CANONICAL_UNITS) as QuantityDimension[]).find((key) => CANONICAL_UNITS[key] === unit);
  if (!dimension) throw new Error(`未登记的内部单位 ${unit}`);
  return dimension;
}
export function unitPresentation(preset: UnitPresetId = "m-kN") {
  const units = UNIT_PRESETS[requireUnitPreset(preset)].units;
  const unit = (canonical: string) => units[unitDimension(canonical)];
  const value = (number: number, canonical: string) => convertQuantity(number, unitDimension(canonical), canonical, unit(canonical));
  const number = (v: number, canonical: string, digits = 8) => Number(value(v, canonical).toPrecision(digits)).toString();
  const quantity = (v: number, canonical: string, digits = 8) => `${number(v, canonical, digits)} ${unit(canonical)}`;
  const vector = (v: { x: number; y: number; z: number }, canonical: string, digits = 8) => `(${[v.x, v.y, v.z].map((n) => number(n, canonical, digits)).join(", ")}) ${unit(canonical)}`;
  const forceVector = (v: readonly number[]) => v.map((n, i) => quantity(n, i % 6 < 3 ? "kN" : "kN·m")).join(", ");
  const mixedVector = (v: readonly number[], kind: "force" | "displacement") => v.map((n, i) => value(n, kind === "force" ? i % 6 < 3 ? "kN" : "kN·m" : i % 6 < 3 ? "m" : "rad"));
  const stiffness = (v: number, row: number, column: number) => v * value(1, row % 6 < 3 ? "kN" : "kN·m") / value(1, column % 6 < 3 ? "m" : "rad");
  return { preset, units, unit, value, number, quantity, vector, forceVector, mixedVector, stiffness };
}
export const UNIT_CONTRACT = { canonical: CANONICAL_UNITS, presets: UNIT_PRESETS, accepted: UNIT_FACTORS,
  externalInput: "必须显式指定单位或使用已声明的工具规范单位契约；缺单位的外部数值需先向用户澄清，禁止按大小猜测。",
  dynamics: "频率 Hz 为周频率。PSD 单边、按 Hz 的谱密度；幅值单位转换因子平方。rad/s 的谱密度与单双边约定需由动态任务显式转换与验证，不作为单纯频率换算。" };
