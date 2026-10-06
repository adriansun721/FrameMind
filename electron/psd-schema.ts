export const PSD_INPUT_SCHEMA = { type: "object", additionalProperties: false,
  required: ["name", "quantity", "excitationUnit", "frequencyUnit", "densityUnit", "sidedness", "band", "points"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 }, quantity: { enum: ["force", "acceleration"] },
    excitationUnit: { enum: ["kN", "N", "m/s²", "mm/s²"] }, frequencyUnit: { enum: ["Hz", "rad/s"] },
    densityUnit: { enum: ["kN²/Hz", "N²/Hz", "kN²/(rad/s)", "N²/(rad/s)", "(m/s²)²/Hz", "(mm/s²)²/Hz", "(m/s²)²/(rad/s)", "(mm/s²)²/(rad/s)"] },
    sidedness: { enum: ["one-sided", "two-sided-even-positive"] },
    band: { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0 } },
    points: { type: "array", minItems: 2, maxItems: 10000, items: { type: "object", additionalProperties: false, required: ["frequency", "density"], properties: { frequency: { type: "number", minimum: 0 }, density: { type: "number", minimum: 0 } } } },
  },
  description: "Random INPUT PSD, not response. Explicit units mandatory, no guessing. Frequency strictly increasing; band equals first/last point. Piecewise linear, exact trapezoid area, zero outside. two-sided-even-positive is only the nonnegative half of an EVEN continuous real-signal spectrum, doubled to normalize. No signed/complex/cross/line spectra. Normalizes to one-sided Hz kN²/Hz or (m/s²)²/Hz; rad/s density and axis both convert, amplitude scaling squared. PSD metadata governs quantities independently of inputUnits. Read saved canonical spectra via read_model collection=psd-spectra. Does not request analysis.",
};

export const PSD_PREPARATION_SCHEMA = { type: "object", additionalProperties: false, required: ["format", "metadata"], properties: {
  format: { enum: ["table", "csv", "white-noise"] },
  metadata: { ...PSD_INPUT_SCHEMA, required: PSD_INPUT_SCHEMA.required.filter((key) => key !== "points"), properties: Object.fromEntries(Object.entries(PSD_INPUT_SCHEMA.properties).filter(([key]) => key !== "points")) },
  points: { ...PSD_INPUT_SCHEMA.properties.points, description: "Required only for format=table." },
  csv: { type: "string", maxLength: 2000000, description: "Required only for format=csv. UTF-8 two columns frequency,density." },
  density: { type: "number", minimum: 0, description: "Required only for format=white-noise, in the declared densityUnit." },
} };
