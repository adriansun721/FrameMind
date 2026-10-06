const positive = { type: "number", exclusiveMinimum: 0 };
const shapes = {
  rectangle: ["width", "height"], circle: ["diameter"], "rectangular-tube": ["width", "height", "thickness"],
  "circular-tube": ["diameter", "thickness"], "i-section": ["width", "height", "webThickness", "flangeThickness"],
};
export const SECTION_GEOMETRY_SCHEMA = { anyOf: Object.entries(shapes).map(([shape, fields]) => ({
  type: "object", additionalProperties: false, required: ["shape", ...fields],
  properties: { shape: { const: shape }, ...Object.fromEntries(fields.map((key) => [key, positive])) },
})) };
export const SECTION_INPUT_SCHEMA = { anyOf: [
  { type: "object", additionalProperties: false, required: ["name", "geometry"], properties: { name: { type: "string", minLength: 1 }, geometry: SECTION_GEOMETRY_SCHEMA } },
  { type: "object", additionalProperties: false, required: ["name", "areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"],
    properties: { name: { type: "string", minLength: 1 }, areaM2: positive, secondMomentYM4: positive, secondMomentZM4: positive, torsionalConstantM4: positive } },
] };
