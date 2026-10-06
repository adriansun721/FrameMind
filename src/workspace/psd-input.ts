import { bandLimitedWhiteNoise, importPsdCsv, integratePsd, normalizePsd, validatePsdInput, type PsdInput } from "../domain/psd";

/** Preparation never mutates the project; reviewed model edits own application. */
export function preparePsdInput(value: Record<string, unknown>) {
  const allowed = value.format === "csv" ? ["format", "metadata", "csv"] : value.format === "white-noise" ? ["format", "metadata", "density"] : ["format", "metadata", "points"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("PSD 准备参数含未定义字段");
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) throw new Error("PSD 准备必须明确单位、约定和频段元数据");
  const metadata = value.metadata as Omit<PsdInput, "points">;
  if (Object.hasOwn(metadata, "points")) throw new Error("PSD 准备元数据不能包含 points");
  let input: PsdInput;
  if (value.format === "csv") {
    if (typeof value.csv !== "string") throw new Error("PSD CSV 必须是文本");
    input = importPsdCsv(value.csv, metadata);
  } else if (value.format === "white-noise") {
    // Validate metadata without allowing a caller-supplied points field to hide an error.
    const validated = validatePsdInput({ ...metadata, points: [{ frequency: metadata.band?.[0], density: value.density }, { frequency: metadata.band?.[1], density: value.density }] });
    input = bandLimitedWhiteNoise(validated.name, { quantity: validated.quantity, excitationUnit: validated.excitationUnit, frequencyUnit: validated.frequencyUnit, densityUnit: validated.densityUnit, sidedness: validated.sidedness }, validated.band, value.density as number);
  } else if (value.format === "table") {
    input = validatePsdInput({ ...metadata, points: value.points });
  } else throw new Error("PSD 准备格式须为 table、csv 或 white-noise");
  const canonical = normalizePsd(input), variance = integratePsd(input);
  const excitationUnit = canonical.excitationUnit;
  return { input, canonical, variance, varianceUnit: `${excitationUnit.includes("/") ? `(${excitationUnit})` : excitationUnit}²`, meaning: "输入随机激励的均方值；不是结构响应、瞬时峰值或确定性位移。保存需 propose_model_edits 后确认。" };
}
