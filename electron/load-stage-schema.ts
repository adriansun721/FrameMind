const identity = { type: "string" };
const source = { type: "string", enum: ["user", "suggestion"] };
const vector = { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } };
const list = (required: string[], properties: Record<string, unknown>) => ({ type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required, properties } });
const named = { id: { type: "string", description: "Existing stable ID to update; omit to create." }, ref: { type: "string", description: "Unique draft reference; use it in loads, combination terms and analysisSourceId. Resolved at confirmation." }, name: identity, source };

export const LOAD_STAGE_SCHEMA = {
  uniformLoads: list(["memberId", "loadCaseId", "coordinateSystem", "intensity", "source"], {
    id: identity, memberId: identity, loadCaseId: identity, source,
    coordinateSystem: { type: "string", enum: ["global", "local"] }, intensity: { ...vector, description: "Full-member uniform force XYZ/xyz in kN/m; no distributed moments." },
  }),
  selfWeight: { type: "object", additionalProperties: false, required: ["enabled", "loadCaseId", "gravity", "source"], properties: {
    enabled: { type: "boolean" }, loadCaseId: identity, gravity: { ...vector, description: "Global gravity acceleration m/s^2; density kg/m^3 and area m^2 come from confirmed member resources." }, source,
  } },
  loadCases: list(["ref", "name", "description", "source"], { ...named, description: identity }),
  loadCombinations: list(["ref", "name", "terms", "source"], { ...named,
    terms: list(["loadCaseId", "factor"], { loadCaseId: identity, factor: { type: "number", description: "User-defined dimensionless coefficient; zero and negative are valid. Never add code factors." } }),
  }),
};
