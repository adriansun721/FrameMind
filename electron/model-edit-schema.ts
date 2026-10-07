import { RANDOM_SETTINGS_SCHEMA } from "./random-schema";
import { MODEL_SECTION_INPUT_SCHEMA as SECTION_INPUT_SCHEMA } from "./section-schema";
import { PSD_INPUT_SCHEMA } from "./psd-schema";
const identity = { type: "string", minLength: 1, maxLength: 200 };
const position = { type: "object", additionalProperties: false, minProperties: 1,
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } };
const bendingRelease = { type: "object", additionalProperties: false, required: ["my", "mz"], properties: { my: { type: "boolean" }, mz: { type: "boolean" } } };
const endReleases = { type: "object", additionalProperties: false, required: ["start", "end"], properties: { start: bendingRelease, end: bendingRelease }, description: "Local My/Mz only; independent of global supports. Omission means rigid. No torsion/axial/shear releases." };
const member = { type: "object", additionalProperties: false, minProperties: 1,
  properties: { startNodeId: identity, endNodeId: identity, materialId: identity, sectionId: identity, rotationDegrees: { type: "number" }, endReleases, additionalLineMassKgM: { type: "number", minimum: 0, description: "Isotropic translational line mass kg/m on reference axis, no rotary inertia; zero removes it." } } };
const topologyProperties = (type: string) => ({
  memberIds: { type: "array", minItems: type === "split_member" ? 1 : 2, maxItems: type === "split_member" ? 1 : 100, uniqueItems: true, items: identity },
  position: { ...position, required: ["x", "y", "z"] }, nodeId: identity,
});
const identityList = { type: "array", uniqueItems: true, items: identity };
const dampingValue = { type: "object", additionalProperties: false, required: ["ratio", "source", "basis"], properties: {
  ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 }, source: { enum: ["user", "suggestion"] }, basis: { type: "string", minLength: 1, maxLength: 500 },
} };
const modalDamping = { type: "object", additionalProperties: false, required: ["uniform", "overrides", "truncation"], properties: {
  uniform: dampingValue, overrides: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: false, required: ["modeNumber", "value"], properties: { modeNumber: { type: "integer", minimum: 1, maximum: 50 }, value: dampingValue } } },
  truncation: { type: "object", additionalProperties: false, required: ["upperFrequencyHz", "modeIncrement", "maxModeCount"], properties: {
    upperFrequencyHz: { type: "number", exclusiveMinimum: 0 }, modeIncrement: { type: "integer", minimum: 1, maximum: 50 }, maxModeCount: { type: "integer", minimum: 1, maximum: 50 },
  } },
} };
export const NODE_MERGE_SELECTION_SCHEMA = {
  nodeIds: { ...identityList, minItems: 2, maxItems: 100 }, targetNodeId: identity, tolerance: { type: "number", minimum: 0 },
};
const mergeProperties = { ...NODE_MERGE_SELECTION_SCHEMA, resolution: { type: "object", additionalProperties: false,
  required: ["keepSupportIds", "keepNodalLoadIds", "keepMemberIds", "removeUniformLoadIds", "acceptGeometryChange"], properties: {
    keepSupportIds: { ...identityList, maxItems: 1 }, keepNodalLoadIds: identityList, keepMemberIds: identityList, removeUniformLoadIds: identityList, acceptGeometryChange: { const: true },
  } } };

const analysisCase = { type: "object", additionalProperties: false, required: ["name", "method", "loadSourceId", "settings"], properties: {
  name: { type: "string", minLength: 1 }, method: { type: "string", enum: ["static", "modal", "buckling", "second-order", "random"] }, loadSourceId: identity,
  settings: { type: "object", additionalProperties: false, required: ["solver"], properties: { solver: { enum: ["native-static", "native-modal", "native-buckling", "native-second-order", "native-random"] },
    random: RANDOM_SETTINGS_SCHEMA,
    secondOrder: { type: "object", additionalProperties: false, required: ["loadSteps", "maxIterations", "residualTolerance", "incrementTolerance", "maxDivisions", "maxEquations", "meshTolerance"], properties: {
      loadSteps: { type: "integer", minimum: 1, maximum: 100 }, maxIterations: { type: "integer", minimum: 1, maximum: 100 },
      residualTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-6 }, incrementTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-6 },
      maxDivisions: { enum: [1, 2, 4, 8, 16] }, maxEquations: { type: "integer", minimum: 1, maximum: 1200 }, meshTolerance: { type: "number", exclusiveMinimum: 0, maximum: .01 },
    }, description: "Initial-stress elastic second-order, small displacements, no axis/axial-force redistribution. LC or CB source. No response superposition." },
    buckling: { type: "object", additionalProperties: false, required: ["fixed", "reference", "modeCount", "maxDivisions", "maxEquations", "factorTolerance"], properties: {
      fixed: { type: "array", items: { type: "object", additionalProperties: false, required: ["loadCaseId", "factor"], properties: { loadCaseId: identity, factor: { type: "number" } } } },
      reference: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["loadCaseId", "factor"], properties: { loadCaseId: identity, factor: { type: "number" } } } },
      modeCount: { type: "integer", minimum: 1, maximum: 20 }, maxDivisions: { enum: [1, 2, 4, 8, 16] }, maxEquations: { type: "integer", minimum: 1, maximum: 1200 }, factorTolerance: { type: "number", exclusiveMinimum: 0, maximum: .01 }
    } },
    modal: { type: "object", additionalProperties: false, required: ["modeCount", "maxDivisions", "maxEquations", "frequencyTolerance"], properties: {
      modeCount: { type: "integer", minimum: 1, maximum: 50 }, maxDivisions: { type: "integer", enum: [1, 2, 4, 8, 16] }, maxEquations: { type: "integer", minimum: 1, maximum: 1200 }, frequencyTolerance: { type: "number", exclusiveMinimum: 0, maximum: 0.01 },
    }, description: "Modal: loadSourceId=structure, solver=native-modal, no mesh. Density forms mass independently of static loads/self-weight." },
    mesh: { type: "object", additionalProperties: false, required: ["maxDivisions", "maxEquations", "relativeTolerance", "displacementTolerance", "forceTolerance"], properties: {
      maxDivisions: { type: "integer", enum: [1, 2, 4, 8, 16] }, maxEquations: { type: "integer", minimum: 1, maximum: 12000 },
      relativeTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-2 }, displacementTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-6 }, forceTolerance: { type: "number", exclusiveMinimum: 0, maximum: 1e-3 },
    } },
  } },
} };

export const MODEL_EDIT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["operations"], properties: {
    operations: { type: "array", minItems: 1, maxItems: 100, items: { anyOf: [
      { type: "object", additionalProperties: false, required: ["type", "properties"], properties: { type: { const: "create_psd_spectrum" }, properties: PSD_INPUT_SCHEMA } },
      { type: "object", additionalProperties: false, required: ["type", "id", "properties"], properties: { type: { const: "update_psd_spectrum" }, id: identity, properties: PSD_INPUT_SCHEMA } },
      { type: "object", additionalProperties: false, required: ["type", "id"], properties: { type: { const: "delete_psd_spectrum" }, id: identity } },
      { type: "object", additionalProperties: false, required: ["type", "id", "analysisId", "properties"], properties: { type: { const: "set_modal_damping" }, id: identity, analysisId: identity, properties: modalDamping } },
      { type: "object", additionalProperties: false, required: ["type", "id", "massKg"], properties: { type: { const: "set_node_mass" }, id: identity, massKg: { type: "number", minimum: 0 } } },
      { type: "object", additionalProperties: false, required: ["type", "properties"], properties: { type: { const: "create_section" }, properties: SECTION_INPUT_SCHEMA } },
      { type: "object", additionalProperties: false, required: ["type", "id", "properties"], properties: { type: { const: "update_section" }, id: identity, properties: SECTION_INPUT_SCHEMA } },
      { type: "object", additionalProperties: false, required: ["type", "id"], properties: { type: { const: "duplicate_section" }, id: identity } },
      { type: "object", additionalProperties: false, required: ["type", "id", "memberIds"], properties: { type: { const: "assign_section" }, id: identity, memberIds: { ...identityList, minItems: 1, maxItems: 100 }, rotationDegrees: { type: "number" } } },
      { type: "object", additionalProperties: false, required: ["type", ...Object.keys(mergeProperties)], properties: { type: { const: "merge_nodes" }, ...mergeProperties } },
      { type: "object", additionalProperties: false, required: ["type", "position"], properties: { type: { const: "create_node" }, position: { ...position, required: ["x", "y", "z"] } } },
      { type: "object", additionalProperties: false, required: ["type", "id", "position"], properties: { type: { const: "update_node" }, id: identity, position } },
      { type: "object", additionalProperties: false, required: ["type", "properties"], properties: { type: { const: "create_member" }, properties: { ...member, required: ["startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees"] } } },
      { type: "object", additionalProperties: false, required: ["type", "id", "changes"], properties: { type: { const: "update_member" }, id: identity, changes: member } },
      ...["split_member", "connect_members"].map((type) => ({ type: "object", additionalProperties: false, required: ["type", "memberIds", "position"], properties: {
        type: { const: type }, ...topologyProperties(type),
      } })),
      { type: "object", additionalProperties: false, required: ["type", "properties"], properties: { type: { const: "create_analysis_case" }, properties: analysisCase } },
      { type: "object", additionalProperties: false, required: ["type", "id", "properties"], properties: { type: { const: "update_analysis_case" }, id: identity, properties: analysisCase } },
      ...["delete_analysis_case", "duplicate_node", "delete_node", "duplicate_member", "delete_member"].map((type) => ({ type: "object", additionalProperties: false, required: ["type", "id"], properties: { type: { const: type }, id: identity } })),
    ] } },
  },
};

const operation = (type: string, fields: Record<string, unknown>, required: string[]) => ({
  type: "function", function: { name: type, description: `Prepare a reviewed ${type.replaceAll("_", " ")} operation using the same domain validation as manual editing. Never apply it directly.`,
    parameters: { type: "object", additionalProperties: false, required, properties: { type: { const: type }, ...fields } } },
});
const nodePosition = { position: { ...position, required: ["x", "y", "z"] } };
const nodeUpdate = { id: identity, position };
const memberProperties = { properties: { ...member, required: ["startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees"] } };
const memberUpdate = { id: identity, changes: member };
const ids = (type: string) => operation(type, { id: identity }, ["id"]);
export const MODEL_EDIT_TOOL_DEFINITIONS = [
  operation("set_node_mass", { id: identity, massKg: { type: "number", minimum: 0, description: "Node isotropic translational point mass kg; no rotary inertia or static gravity load. Zero removes it." } }, ["id", "massKg"]),
  { type: "function", function: { name: "merge_nodes", description: "Prepare a reviewed atomic node merge. Inspect near nodes and merge impact first. All nodes must be within tolerance of the explicit target; retain its position and identity. Explicitly list retained support (at most one), nodal loads and members, and every removed member's uniform loads. Keeping multiple loads means deliberate superposition; keeping duplicate members means parallel elements. Accept changes to lengths/local load axes. No implicit condition accumulation or deletion. Read replacement identities after confirmation.",
    parameters: { type: "object", additionalProperties: false, required: Object.keys(mergeProperties), properties: mergeProperties } } },
  ...["split_member", "connect_members"].map((name) => ({ type: "function", function: { name,
    description: "Prepare explicit engineering topology for user confirmation, NOT internal solver subdivision. split_member takes one member; connect_members takes 2-100 members at a common point. Existing exact-position node requires explicit nodeId. Preserve material, section, local orientation and uniform intensity over disjoint child ranges; refuse endpoint identity conflicts. Read the replacement identity mapping after confirmation before further edits.",
    parameters: { type: "object", additionalProperties: false, required: ["memberIds", "position"], properties: topologyProperties(name) } } })),
  { type: "function", function: { name: "draw_member", description: "Prepare one atomic member segment and any new endpoints for user confirmation. Explicit nodeId reuses that existing identity and must match its position exactly. Omitting nodeId creates a new node; no grid snap, automatic merge, crossing connection or split. Coordinates use canonical metres unless inputUnits declares length.",
    parameters: { type: "object", additionalProperties: false, required: ["start", "end", "materialId", "sectionId"], properties: {
      start: { type: "object", additionalProperties: false, required: ["position"], properties: { position: { ...position, required: ["x", "y", "z"] }, nodeId: identity } },
      end: { type: "object", additionalProperties: false, required: ["position"], properties: { position: { ...position, required: ["x", "y", "z"] }, nodeId: identity } },
      materialId: identity, sectionId: identity, rotationDegrees: { type: "number", default: 0 },
    } } } },
  operation("create_node", nodePosition, ["position"]), operation("create_nodes", { nodes: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["position"], properties: nodePosition } } }, ["nodes"]),
  operation("update_node", nodeUpdate, ["id", "position"]), operation("update_nodes", { updates: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "position"], properties: nodeUpdate } } }, ["updates"]),
  ids("duplicate_node"), operation("duplicate_nodes", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]), ids("delete_node"), operation("delete_nodes", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]),
  operation("create_member", memberProperties, ["properties"]), operation("create_members", { members: { type: "array", minItems: 1, maxItems: 100, items: memberProperties.properties } }, ["members"]),
  operation("update_member", memberUpdate, ["id", "changes"]), operation("update_members", { updates: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "changes"], properties: memberUpdate } } }, ["updates"]),
  ids("duplicate_member"), operation("duplicate_members", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]), ids("delete_member"), operation("delete_members", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]),
];
