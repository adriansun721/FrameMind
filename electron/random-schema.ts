const identity = { type: "string", minLength: 1 };
const number = { type: "number" };
const legacySettings = { type: "object", additionalProperties: false,
  required: ["modalAnalysisId", "psdSpectrumId", "excitation", "response", "bandHz", "frequencyPoints", "maxFrequencyPoints", "maxRefinements", "modeIncrement", "relativeTolerance", "absolutePsdTolerance", "absoluteVarianceTolerance", "absoluteRmsTolerance", "integration"],
  description: "One stationary node force source, global XYZ unit direction and dimensionless spatial scale. Bind latest current converged modal analysis with reviewed damping and a canonical one-sided force PSD. Full band required. RMS is statistical, never a peak/displacement shape. Frozen modal/damping/spectrum dependencies expire on change. Accuracy defaults are suggestions, budgets fail without partial results.",
  properties: {
    modalAnalysisId: identity, psdSpectrumId: identity,
    excitation: { type: "object", additionalProperties: false, required: ["nodeId", "direction", "scale"], properties: { nodeId: identity,
      direction: { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: number, y: number, z: number }, description: "Global unit vector; norm must equal one." }, scale: number } },
    response: { type: "object", additionalProperties: false, required: ["nodeId", "component"], properties: { nodeId: identity, component: { enum: ["x", "y", "z"] } } },
    bandHz: { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0 }, description: "Must equal the full saved input PSD band; no cropped RMS." },
    frequencyPoints: { type: "integer", minimum: 3, maximum: 10001 }, maxFrequencyPoints: { type: "integer", minimum: 3, maximum: 20001 }, maxRefinements: { type: "integer", minimum: 1, maximum: 12 }, modeIncrement: { type: "integer", minimum: 1, maximum: 49 },
    relativeTolerance: { type: "number", exclusiveMinimum: 0, maximum: .01 }, absolutePsdTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-12 }, absoluteVarianceTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-12 }, absoluteRmsTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-6 },
    integration: { const: "trapezoidal" },
  },
};

const direction = legacySettings.properties.excitation.properties.direction;
const source = { type: "object", additionalProperties: false, required: ["sourceId", "psdSpectrumId", "actions"], properties: {
  sourceId: { ...identity, maxLength: 200 }, psdSpectrumId: identity,
  actions: { type: "array", minItems: 1, maxItems: 128, items: { oneOf: [
    { type: "object", additionalProperties: false, required: ["kind", "direction", "scale"], properties: { kind: { const: "base-translation" }, direction, scale: { ...number, description: "Dimensionless signed coefficient of one acceleration process (canonical m/s²). Every support shares this motion and must restrain every nonzero direction. No target subset, differential supports or base rotation. Each source is exclusively acceleration or force; independent sources may coexist. Output is global translation relative to the moving base, not absolute response." } } },
    { type: "object", additionalProperties: false, required: ["kind", "nodeId", "direction", "scale"], properties: { kind: { const: "node" }, nodeId: identity, direction, scale: number } },
    { type: "object", additionalProperties: false, required: ["kind", "memberId", "direction", "scalePerM"], properties: { kind: { const: "member-uniform" }, memberId: identity, direction, scalePerM: { ...number, description: "Signed coefficient in canonical 1/m. Whole engineering member, uniform in global XYZ. Source process is force (kN); line force is process times coefficient. Explicit inputUnits.inverseLength may convert 1/mm." } } },
  ] } },
} };
const { excitation: _excitation, psdSpectrumId: _spectrum, ...common } = legacySettings.properties;
export const RANDOM_SETTINGS_SCHEMA = { oneOf: [legacySettings, {
  type: "object", additionalProperties: false,
  required: [...legacySettings.required.filter((key) => !["excitation", "psdSpectrumId"].includes(key)), "sourceRelationship", "sources"],
  description: "Stationary force or whole-base acceleration sources, one quantity per source. All actions within one source share the same random process: sum signed modal forces before magnitude squared. Different sourceIds are independent even if bound to the same PSD table: sum response PSD, never RMS. Force and base acceleration may coexist only as independent sources. Base displacement response is relative to the moving base in global XYZ. Reject differential support targets, base rotation, partial correlation, cross spectra and phase. Max 16 sources and 128 total actions. All spectra must use the same full band. Frozen sources/actions/spectra expire on any dependency change. Legacy single-node format remains supported separately.",
  properties: { ...common, sourceRelationship: { const: "independent" }, sources: { type: "array", minItems: 1, maxItems: 16, items: source } },
}] };
