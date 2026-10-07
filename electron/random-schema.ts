const identity = { type: "string", minLength: 1 };
const number = { type: "number" };
export const RANDOM_SETTINGS_SCHEMA = { type: "object", additionalProperties: false,
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
