/** Idealized, doubly symmetric sections. All dimensions are canonical metres. */
export type SectionGeometry =
  | { shape: "rectangle"; width: number; height: number }
  | { shape: "circle"; diameter: number }
  | { shape: "rectangular-tube"; width: number; height: number; thickness: number }
  | { shape: "circular-tube"; diameter: number; thickness: number }
  | { shape: "i-section"; width: number; height: number; webThickness: number; flangeThickness: number };

export const SECTION_SHAPES = {
  rectangle: "实心矩形", circle: "实心圆", "rectangular-tube": "矩形管", "circular-tube": "圆管", "i-section": "对称 I/H",
} as const;
export const SECTION_DIMENSIONS = {
  width: "宽度 b（局部 y）", height: "高度 h（局部 z）", diameter: "外径 d", thickness: "壁厚 t",
  webThickness: "腹板厚 tw", flangeThickness: "翼缘厚 tf",
} as const;
export const SECTION_SHAPE_FIELDS: Record<SectionGeometry["shape"], readonly (keyof typeof SECTION_DIMENSIONS)[]> = {
  rectangle: ["width", "height"], circle: ["diameter"], "rectangular-tube": ["width", "height", "thickness"],
  "circular-tube": ["diameter", "thickness"], "i-section": ["width", "height", "webThickness", "flangeThickness"],
};
export const SECTION_FORMULA_SOURCE = "https://www.steelconstruction.info/images/6/6f/Sci_p385.pdf";
export function sectionParameterBasis(shape: SectionGeometry["shape"]) {
  return { method: "idealized-section-v1", source: "SCI P385 (2011), Appendix B.2; A/I by area integration", url: SECTION_FORMULA_SOURCE,
    notes: shape === "rectangle" ? "J：SCI B.2.1 矩形近似；A/I 为理想矩形精确积分。"
      : shape === "rectangular-tube" ? "J：SCI B.2.3 薄壁闭口中线近似；壁厚/最小外尺寸 ≤ 0.1。忽略圆角。"
        : shape === "i-section" ? "J：SCI B.2.2 薄壁开口近似；tf/b、tw/(h−2tf) ≤ 0.1。忽略圆角及翘曲刚度。"
          : "理想圆形/同心圆环，J = Iy + Iz；忽略制造偏差。" };
}

export function validateSectionGeometry(value: unknown): SectionGeometry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("截面几何必须为尺寸对象");
  const raw = value as Record<string, unknown>;
  if (typeof raw.shape !== "string" || !Object.hasOwn(SECTION_SHAPE_FIELDS, raw.shape)) throw new Error("仅支持五类双对称截面");
  const fields = SECTION_SHAPE_FIELDS[raw.shape as SectionGeometry["shape"]];
  if (Object.keys(raw).some((key) => key !== "shape" && !fields.includes(key as keyof typeof SECTION_DIMENSIONS))) throw new Error("截面尺寸含未定义字段");
  for (const key of fields) if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] <= 0) throw new Error(`${SECTION_DIMENSIONS[key]}必须为正有限数值`);
  const g = { ...raw } as SectionGeometry;
  if (g.shape === "rectangular-tube" || g.shape === "circular-tube") {
    const size = g.shape === "rectangular-tube" ? Math.min(g.width, g.height) : g.diameter;
    if (2 * g.thickness >= size) throw new Error("壁厚必须小于最小外尺寸的一半");
    if (g.shape === "rectangular-tube" && g.thickness / size > .1 + 1e-14) throw new Error("矩形管薄壁近似要求壁厚/最小外尺寸 ≤ 0.1");
  }
  if (g.shape === "i-section") {
    if (2 * g.flangeThickness >= g.height || g.webThickness >= g.width) throw new Error("I/H 翼缘或腹板尺寸无效");
    if (g.flangeThickness / g.width > .1 + 1e-14 || g.webThickness / (g.height - 2 * g.flangeThickness) > .1 + 1e-14) throw new Error("I/H 薄壁近似要求 tf/b、tw/(h−2tf) ≤ 0.1");
  }
  return g;
}

export function sectionMechanicalProperties(value: unknown) {
  const g = validateSectionGeometry(value);
  let areaM2: number, secondMomentYM4: number, secondMomentZM4: number, torsionalConstantM4: number;
  if (g.shape === "circle" || g.shape === "circular-tube") {
    const d = g.diameter, inner = g.shape === "circle" ? 0 : d - 2 * g.thickness;
    areaM2 = Math.PI * (d - inner) * (d + inner) / 4;
    secondMomentYM4 = Math.PI * (d - inner) * (d + inner) * (d * d + inner * inner) / 64;
    secondMomentZM4 = secondMomentYM4; torsionalConstantM4 = 2 * secondMomentYM4;
  } else if (g.shape === "i-section") {
    const b = g.width, h = g.height, tw = g.webThickness, tf = g.flangeThickness, web = h - 2 * tf;
    areaM2 = 2 * b * tf + web * tw;
    secondMomentYM4 = tw * web ** 3 / 12 + 2 * (b * tf ** 3 / 12 + b * tf * ((h - tf) / 2) ** 2);
    secondMomentZM4 = 2 * tf * b ** 3 / 12 + web * tw ** 3 / 12;
    torsionalConstantM4 = (2 * b * tf ** 3 + web * tw ** 3) / 3;
  } else {
    const b = g.width, h = g.height;
    if (g.shape === "rectangle") {
      areaM2 = b * h; secondMomentYM4 = b * h ** 3 / 12; secondMomentZM4 = h * b ** 3 / 12;
      const a = Math.max(b, h), c = Math.min(b, h), ratio = c / a;
      torsionalConstantM4 = a * c ** 3 * (1 / 3 - .21 * ratio * (1 - ratio ** 4 / 12));
    } else {
      const t = g.thickness, bi = b - 2 * t, hi = h - 2 * t;
      // Disjoint plates avoid catastrophic subtraction for small wall thickness.
      areaM2 = 2 * b * t + 2 * hi * t;
      secondMomentYM4 = 2 * (b * t ** 3 / 12 + b * t * ((h - t) / 2) ** 2) + 2 * t * hi ** 3 / 12;
      secondMomentZM4 = 2 * t * b ** 3 / 12 + 2 * (hi * t ** 3 / 12 + hi * t * ((b - t) / 2) ** 2);
      const midArea = (b - t) * (h - t), perimeter = 2 * (b + h - 2 * t);
      torsionalConstantM4 = 4 * t * midArea ** 2 / perimeter;
      if (!(bi > 0 && hi > 0)) throw new Error("矩形管内尺寸无效");
    }
  }
  const properties = { areaM2, secondMomentYM4, secondMomentZM4, torsionalConstantM4 };
  if (Object.values(properties).some((v) => !Number.isFinite(v) || v <= 0)) throw new Error("截面尺寸超出有限正参数计算范围");
  return properties;
}
