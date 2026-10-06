import { convertQuantity } from "./units";

export type PsdQuantity = "force" | "acceleration";
export type PsdSidedness = "one-sided" | "two-sided-even-positive";
export interface PsdConvention {
  quantity: PsdQuantity;
  excitationUnit: string;
  frequencyUnit: "Hz" | "rad/s";
  densityUnit: string;
  sidedness: PsdSidedness;
}
export interface PsdPoint { frequency: number; density: number; }
export interface PsdInput extends PsdConvention {
  name: string;
  band: [number, number];
  points: PsdPoint[];
}
export interface PsdSpectrum extends PsdInput {
  id: string;
  interpolation: "linear";
  outsideBand: "zero";
}
export const PSD_MAX_POINTS = 10000;
export function psdDensityUnit(excitationUnit: string, frequencyUnit: PsdConvention["frequencyUnit"]): string {
  return `${excitationUnit.includes("/") ? `(${excitationUnit})` : excitationUnit}²/${frequencyUnit === "Hz" ? "Hz" : "(rad/s)"}`;
}
export function canonicalPsdConvention(quantity: PsdQuantity): PsdConvention {
  const excitationUnit = quantity === "force" ? "kN" : "m/s²";
  return { quantity, excitationUnit, frequencyUnit: "Hz", densityUnit: psdDensityUnit(excitationUnit, "Hz"), sidedness: "one-sided" };
}
function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PSD 必须是对象");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key))) throw new Error("PSD 含未定义字段");
  return input;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("PSD 频率和密度必须是非负有限数值");
  return value;
}
export function validatePsdConvention(value: unknown): PsdConvention {
  const v = record(value, ["quantity", "excitationUnit", "frequencyUnit", "densityUnit", "sidedness"]);
  if (v.quantity !== "force" && v.quantity !== "acceleration") throw new Error("请明确 PSD 激励量：力或平动加速度");
  if (v.frequencyUnit !== "Hz" && v.frequencyUnit !== "rad/s") throw new Error("请明确 PSD 频率单位 Hz 或 rad/s");
  if (v.sidedness !== "one-sided" && v.sidedness !== "two-sided-even-positive") throw new Error("请明确单边谱或双边偶谱正频半轴约定");
  if (typeof v.excitationUnit !== "string" || typeof v.densityUnit !== "string") throw new Error("PSD 缺少激励量或谱密度单位");
  convertQuantity(1, v.quantity, v.excitationUnit, canonicalPsdConvention(v.quantity).excitationUnit);
  if (v.densityUnit !== psdDensityUnit(v.excitationUnit, v.frequencyUnit)) throw new Error("PSD 密度单位必须与激励量平方及频率单位一致");
  return { quantity: v.quantity, excitationUnit: v.excitationUnit, frequencyUnit: v.frequencyUnit, densityUnit: v.densityUnit, sidedness: v.sidedness };
}
export function validatePsdInput(value: unknown): PsdInput {
  const v = record(value, ["name", "quantity", "excitationUnit", "frequencyUnit", "densityUnit", "sidedness", "band", "points"]);
  const convention = validatePsdConvention(Object.fromEntries(["quantity", "excitationUnit", "frequencyUnit", "densityUnit", "sidedness"].map((key) => [key, v[key]])));
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 200) throw new Error("PSD 名称需为 1 至 200 字符");
  if (!Array.isArray(v.band) || v.band.length !== 2) throw new Error("请明确 PSD 有效频段");
  const band: [number, number] = [finite(v.band[0]), finite(v.band[1])];
  if (!(band[1] > band[0])) throw new Error("PSD 有效频段必须有正宽度");
  if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > PSD_MAX_POINTS) throw new Error(`PSD 需包含 2 至 ${PSD_MAX_POINTS} 个点`);
  const points = v.points.map((point) => { const p = record(point, ["frequency", "density"]); return { frequency: finite(p.frequency), density: finite(p.density) }; });
  for (let i = 1; i < points.length; i++) if (points[i].frequency <= points[i - 1].frequency) throw new Error(`PSD 第 ${i + 1} 点频率须严格递增，不允许重复点或自动排序`);
  if (points[0].frequency !== band[0] || points.at(-1)!.frequency !== band[1]) throw new Error("PSD 首末点必须与显式有效频段一致");
  return { name: v.name.trim(), ...convention, band, points };
}
function tableArea(input: PsdInput): number {
  let area = 0;
  for (let i = 1; i < input.points.length; i++) {
    const a = input.points[i - 1], b = input.points[i];
    const height = Math.min(a.density, b.density) + Math.abs(b.density - a.density) / 2, width = b.frequency - a.frequency;
    const part = height * width;
    if (!Number.isFinite(part) || (height > 0 && part === 0)) throw new Error("PSD 积分超出有限数值精度范围");
    area += part;
  }
  if (!Number.isFinite(area)) throw new Error("PSD 积分溢出");
  return area;
}
/** Physical variance, always in the canonical excitation unit squared. */
export function integratePsd(value: PsdInput): number {
  const input = validatePsdInput(value), canonical = canonicalPsdConvention(input.quantity);
  const area = tableArea(input);
  // Area already integrates over the declared axis: no frequency Jacobian here.
  const scaled = convertQuantity(area, input.quantity === "force" ? "forcePSD" : "accelerationPSD", psdDensityUnit(input.excitationUnit, "Hz"), canonical.densityUnit);
  const variance = scaled * (input.sidedness === "one-sided" ? 1 : 2);
  if (!Number.isFinite(variance)) throw new Error("PSD 均方值溢出");
  return variance;
}
export function convertPsd(value: PsdInput, target: PsdConvention): PsdInput {
  const source = validatePsdInput(value), convention = validatePsdConvention(target);
  if (source.quantity !== convention.quantity) throw new Error("PSD 转换不能改变激励物理量");
  const densityDimension = source.quantity === "force" ? "forcePSD" : "accelerationPSD";
  const sideFactor = (source.sidedness === "one-sided" ? 1 : 2) / (convention.sidedness === "one-sided" ? 1 : 2);
  const axis = (n: number) => convertQuantity(n, "frequency", source.frequencyUnit, convention.frequencyUnit);
  const points = source.points.map((p) => {
    const density = convertQuantity(p.density, densityDimension, source.densityUnit, convention.densityUnit) * sideFactor;
    if (!Number.isFinite(density) || (p.density !== 0 && density === 0)) throw new Error("PSD 密度转换超出有限数值精度范围");
    return { frequency: axis(p.frequency), density };
  });
  const result = validatePsdInput({ name: source.name, ...convention, band: source.band.map(axis), points });
  const before = integratePsd(source), after = integratePsd(result);
  if (Math.abs(before - after) > Math.max(before * 1e-12, Number.MIN_VALUE)) throw new Error("PSD 转换未保持物理谱面积");
  return result;
}
export function normalizePsd(value: unknown): PsdInput {
  const input = validatePsdInput(value);
  return convertPsd(input, canonicalPsdConvention(input.quantity));
}
export function decodePsdSpectrum(value: unknown): PsdSpectrum {
  const v = record(value, ["id", "interpolation", "outsideBand", "name", "quantity", "excitationUnit", "frequencyUnit", "densityUnit", "sidedness", "band", "points"]);
  const { id, interpolation, outsideBand, ...input } = v;
  if (typeof id !== "string" || !/^PSD[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(3)))) throw new Error("PSD 稳定标识无效");
  if (interpolation !== "linear" || outsideBand !== "zero") throw new Error("PSD 插值或频段外约定无效");
  const checked = validatePsdInput(input);
  if (checked.frequencyUnit !== "Hz" || checked.sidedness !== "one-sided" || checked.excitationUnit !== canonicalPsdConvention(checked.quantity).excitationUnit) throw new Error("保存的 PSD 必须使用规范单边 Hz 单位");
  integratePsd(checked);
  return { id, ...checked, interpolation, outsideBand };
}
export function psdSpectrumInput(spectrum: PsdSpectrum): PsdInput {
  const { id: _id, interpolation: _interpolation, outsideBand: _outside, ...input } = spectrum;
  return input;
}
export function evaluatePsd(value: PsdInput, frequency: number): number {
  const input = validatePsdInput(value);
  if (!Number.isFinite(frequency)) throw new Error("PSD 查询频率必须有限");
  if (frequency < input.band[0] || frequency > input.band[1]) return 0;
  for (let i = 1; i < input.points.length; i++) {
    const a = input.points[i - 1], b = input.points[i];
    if (frequency <= b.frequency) { const t = (frequency - a.frequency) / (b.frequency - a.frequency); return a.density * (1 - t) + b.density * t; }
  }
  return 0;
}
export function bandLimitedWhiteNoise(name: string, convention: PsdConvention, band: [number, number], density: number): PsdInput {
  return validatePsdInput({ name, ...convention, band, points: [{ frequency: band[0], density }, { frequency: band[1], density }] });
}
export function importPsdCsv(csv: string, metadata: Omit<PsdInput, "points">): PsdInput {
  if (csv.length > 2000000) throw new Error("PSD CSV 超出 2 MB 文本预算");
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const cellsOf = (line: string) => line.split(",").map((cell) => cell.trim().replace(/^"([^"]*)"$/, "$1"));
  const header = cellsOf(lines[0]);
  if (header.length !== 2 || header[0] !== "frequency" || header[1] !== "density") throw new Error("PSD CSV 表头必须为 frequency,density；单位在导入面板明确选择");
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const points = lines.slice(1).map((line, i) => {
    const cells = cellsOf(line);
    if (cells.length !== 2 || cells.some((cell) => !decimal.test(cell))) throw new Error(`PSD CSV 第 ${i + 2} 行需两个有限十进制数值`);
    return { frequency: Number(cells[0]), density: Number(cells[1]) };
  });
  return validatePsdInput({ ...metadata, points });
}
