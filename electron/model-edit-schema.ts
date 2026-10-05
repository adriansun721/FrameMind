const identity = { type: "string", minLength: 1, maxLength: 200 };
const position = { type: "object", additionalProperties: false, minProperties: 1,
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } };
const member = { type: "object", additionalProperties: false, minProperties: 1,
  properties: { startNodeId: identity, endNodeId: identity, materialId: identity, sectionId: identity, rotationDegrees: { type: "number" } } };

const analysisCase = { type: "object", additionalProperties: false, required: ["name", "method", "loadSourceId", "settings"], properties: {
  name: { type: "string", minLength: 1 }, method: { type: "string", enum: ["static"] }, loadSourceId: identity,
  settings: { type: "object", additionalProperties: false, required: ["solver"], properties: { solver: { const: "native-static" } } },
} };

export const MODEL_EDIT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["operations"], properties: {
    operations: { type: "array", minItems: 1, maxItems: 100, items: { anyOf: [
      { type: "object", additionalProperties: false, required: ["type", "position"], properties: { type: { const: "create_node" }, position: { ...position, required: ["x", "y", "z"] } } },
      { type: "object", additionalProperties: false, required: ["type", "id", "position"], properties: { type: { const: "update_node" }, id: identity, position } },
      { type: "object", additionalProperties: false, required: ["type", "properties"], properties: { type: { const: "create_member" }, properties: { ...member, required: Object.keys(member.properties) } } },
      { type: "object", additionalProperties: false, required: ["type", "id", "changes"], properties: { type: { const: "update_member" }, id: identity, changes: member } },
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
  operation("create_node", nodePosition, ["position"]), operation("create_nodes", { nodes: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["position"], properties: nodePosition } } }, ["nodes"]),
  operation("update_node", nodeUpdate, ["id", "position"]), operation("update_nodes", { updates: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "position"], properties: nodeUpdate } } }, ["updates"]),
  ids("duplicate_node"), operation("duplicate_nodes", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]), ids("delete_node"), operation("delete_nodes", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]),
  operation("create_member", memberProperties, ["properties"]), operation("create_members", { members: { type: "array", minItems: 1, maxItems: 100, items: memberProperties.properties } }, ["members"]),
  operation("update_member", memberUpdate, ["id", "changes"]), operation("update_members", { updates: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "changes"], properties: memberUpdate } } }, ["updates"]),
  ids("duplicate_member"), operation("duplicate_members", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]), ids("delete_member"), operation("delete_members", { ids: { type: "array", minItems: 1, maxItems: 100, items: identity } }, ["ids"]),
];
