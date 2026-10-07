import { SECTION_INPUT_SCHEMA } from "./section-schema";
import { PSD_PREPARATION_SCHEMA } from "./psd-schema";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { LOAD_STAGE_SCHEMA } from "./load-stage-schema";
import { MODEL_EDIT_SCHEMA, MODEL_EDIT_TOOL_DEFINITIONS, NODE_MERGE_SELECTION_SCHEMA } from "./model-edit-schema";
import { DEEPSEEK_MODELS, type DeepSeekModel, type DeepSeekSettings, type DeepSeekStatus, type DeepSeekResult,
  type DeepSeekChatRequest, type DeepSeekChatResult, type DeepSeekAssistantMessage, type DeepSeekChatMessage,
  type DeepSeekToolCall } from "./contracts";

export interface CredentialEncryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
interface Credential { version: 1; apiKey: string; model: DeepSeekModel; }
interface StoredSettings { settings: DeepSeekSettings; credential?: Credential; }

const modelTools = [
  { type: "function", function: { name: "read_section_contract", description: "Read checked standard catalog entries, archived geometry and mechanics, idealized comparison, legacy missing geometry, axes and formula limits before proposing parameter sections. Never infer geometry from legacy A/I/J properties.", parameters: { type: "object", additionalProperties: false, properties: {} } } },
  { type: "function", function: { name: "inspect_near_nodes", description: "Read duplicate/near node pairs using a fixed Euclidean length tolerance (default 1e-6 m; 0 exact duplicates). Camera zoom and coordinate magnitude do not change it. Never merges. Pairwise chains do not authorize a whole-group merge.", parameters: { type: "object", additionalProperties: false, properties: { tolerance: { type: "number", minimum: 0 } } } } },
  { type: "function", function: { name: "inspect_node_merge", description: "Read merge impact before choosing a conflict resolution: target identity/position, distances, affected members/axes, supports/restraints, loads/cases, duplicate members, zero-length members and task references. Does not change the model. Provide explicit retained/deleted conditions in merge_nodes for user confirmation.", parameters: { type: "object", additionalProperties: false, required: Object.keys(NODE_MERGE_SELECTION_SCHEMA), properties: NODE_MERGE_SELECTION_SCHEMA } } },
  { type: "function", function: { name: "read_geometry_contract", description: "Read independent picking, snapping, exact coordinate duplicate and solver tolerances in canonical metres. Finite XYZ may be negative, fractional or outside the visual grid. Connections use explicit node IDs; crossing or coincident geometry never automatically connects or splits members.", parameters: { type: "object", additionalProperties: false, properties: {} } } },
  { type: "function", function: { name: "read_unit_contract", description: "Read canonical units, display presets and external-data unit rules. Never infer missing units from magnitude.", parameters: { type: "object", additionalProperties: false, properties: {} } } },
  { type: "function", function: { name: "convert_quantity", description: "Convert a quantity with explicitly declared dimension and source/target units. Missing or incompatible units are rejected.", parameters: { type: "object", additionalProperties: false, required: ["value", "dimension", "fromUnit", "toUnit"], properties: { value: { type: "number" }, dimension: { type: "string" }, fromUnit: { type: "string" }, toUnit: { type: "string" } } } } },
  { type: "function", function: { name: "propose_section_change", description: "Preview section reassignment for EXACTLY the currently selected vertical columns. Never updates a shared section or unselected members. Use either an existing project/catalog sectionId or new section properties. User must confirm the stage.",
    parameters: { type: "object", additionalProperties: false, required: ["source"], properties: {
      memberIds: { type: "array", items: { type: "string" }, description: "Optional, must exactly equal current selected columns." }, sectionId: { type: "string" },
      source: { type: "string", enum: ["user", "suggestion"] }, section: SECTION_INPUT_SCHEMA,
    } } } },
  { type: "function", function: { name: "discard_section_change", description: "Reject the pending section change without changing the applied model or results.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_comparison", description: "Read the two explicitly selected analysis IDs, input changes, self weight and the SAME deltas as the comparison table. Different sources are marked incompatible; other changes must not be attributed solely to sections.",
    parameters: { type: "object", additionalProperties: false, required: ["collection"], properties: { beforeId: { type: "string" }, afterId: { type: "string" }, collection: { type: "string", enum: ["summary", "nodes", "members"] }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } } } } },
  { type: "function", function: { name: "read_comparison_result", description: "Verify actual before/after values and delta for the selected analysis pair, returning a clickable comparison token. Cite the exact token. Refuses incompatible sources.",
    parameters: { type: "object", additionalProperties: false, required: ["kind", "id", "quantity", "component"], properties: { beforeId: { type: "string" }, afterId: { type: "string" }, kind: { type: "string", enum: ["node", "member"] }, id: { type: "string" },
      quantity: { type: "string", enum: ["displacement", "rotation", "reaction", "reactionMoment", "sectionForces", "startEndForces", "endEndForces"] }, component: { type: "string", enum: ["x", "y", "z", "N", "Vy", "Vz", "T", "My", "Mz"] }, position: { type: "number", minimum: 0 } } } } },
  { type: "function", function: { name: "read_results", description: "Random: summary reads statistical translation RMS, complete band, frozen modal/damping/spectrum provenance and separate PSD/integration/truncation convergence. input-psd returns paginated frozen input spectrum points tagged with sourceId and psdSpectrumId (including history); summary.inputSources lists every frozen spectrum, not the current edited resource. psd returns paginated response density m2/Hz, never input PSD or static deformation. Only selected global node component supported. read_result quantity=rms creates a statistical citation. No RMS superposition. Modal: summary and modes include effective damping with ratio/source/basis, bound analysis identity and truncation checks. Missing or needs-review damping is null; never silently transfer numbered overrides after recomputation. Frequency coverage/convergence does not establish response accuracy; PSD/RMS convergence remains unverified until random analysis. Modal: modes reads normalized mode shapes and frequencies (not static displacements); mass reads separate structural density/geometry and explicit point/line sources with frozen object IDs. Static loads and self-weight are not mass. Read the selected completed analysis, its frozen input provenance and actual results. Summary includes the frozen mesh policy, actual engineering/calculation counts, convergence status and normalized errors. mesh returns paginated frozen engineering-member/element/station mappings; internal IDs are read-only and never editable engineering targets. Budget-exhausted results are not converged. Summary includes node displacement component extrema, not continuous member extrema. Historical results are explicitly marked. Nodes and members support bounded fields/query filtering.",
    parameters: { type: "object", additionalProperties: false, required: ["collection"], properties: {
      analysisId: { type: "string" }, collection: { type: "string", enum: ["summary", "nodes", "members", "mesh", "modes", "mass", "psd", "input-psd"] },
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, fields: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
      query: { type: "object", additionalProperties: false, required: ["field"], properties: { field: { type: "string" }, equals: {}, min: { type: "number" }, max: { type: "number" } } },
    } } } },
  { type: "function", function: { name: "read_result", description: "Verify one actual numeric result and create a clickable reference token. Cite this token verbatim in the explanation. Never supplies safety or code compliance checks. Member end forces and positive-local-x-face section actions have different signs.",
    parameters: { type: "object", additionalProperties: false, required: ["kind", "id", "quantity", "component"], properties: {
      analysisId: { type: "string" }, kind: { type: "string", enum: ["node", "member"] }, id: { type: "string" },
      quantity: { type: "string", enum: ["displacement", "rotation", "reaction", "reactionMoment", "sectionForces", "startEndForces", "endEndForces", "rms"] },
      component: { type: "string", enum: ["x", "y", "z", "N", "Vy", "Vz", "T", "My", "Mz"] }, position: { type: "number", minimum: 0, description: "Required only for sectionForces; metres from the frozen member start." },
    } } } },
  { type: "function", function: { name: "inspect_diagnostics", description: "Check the applied model for complete inputs, geometry, topology, connections and constraints. Returns structured evidence and locatable object IDs; it never changes the model.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "create_diagnostic_copy", description: "Create an independently identified diagnostic copy from the current applied model. Candidate engineering changes stay in this copy and never change the formal project.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "run_diagnostic_trial", description: "Run a bounded candidate trial inside the current diagnostic copy. Failures and results remain isolated; any engineering change requires a reviewed formal draft before application.", parameters: { type: "object", additionalProperties: false, required: ["label", "operations"], properties: { label: { type: "string", minLength: 1, maxLength: 200 }, sourceId: { type: "string", description: "Optional LC or CB source to solve; otherwise the copy's active source is used." }, operations: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["type"], properties: { type: { type: "string", enum: ["set_support", "remove_support", "set_nodal_load", "remove_nodal_load", "set_uniform_load", "remove_uniform_load", "set_self_weight", "set_node_position", "set_member"] }, id: { type: "string" }, nodeId: { type: "string" }, memberId: { type: "string" }, restraints: { type: "array", minItems: 6, maxItems: 6, items: { type: "boolean" } }, loadCaseId: { type: "string" }, force: { type: "object" }, moment: { type: "object" }, coordinateSystem: { type: "string", enum: ["global", "local"] }, intensity: { type: "object" }, input: { type: "object" }, position: { type: "object" }, changes: { type: "object" } } } } } } } },
  { type: "function", function: { name: "read_diagnostic", description: "Read the current diagnostic copy, its source, candidate model collections, trial evidence and summaries with bounded pagination.", parameters: { type: "object", additionalProperties: false, required: ["collection"], properties: { collection: { type: "string", enum: ["summary", "nodes", "members", "supports", "loads", "trials"] }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } } } } },
  { type: "function", function: { name: "compare_diagnostic_trials", description: "Compare two trials from the same diagnostic copy when both have compatible numerical results. Reports evidence and response deltas without treating success as engineering correctness.", parameters: { type: "object", additionalProperties: false, required: ["beforeTrialId", "afterTrialId"], properties: { beforeTrialId: { type: "string" }, afterTrialId: { type: "string" } } } } },
  { type: "function", function: { name: "discard_diagnostic_copy", description: "Discard the current diagnostic copy and trial evidence without changing formal model or results.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "request_analysis", description: "Queue a local analysis only when the user explicitly requests computation of the applied model. Does not compute itself; unconfirmed changes still require stage confirmation.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "discard_frame_proposal", description: "Discard the current unapplied frame proposal when the user rejects or cancels it. Never changes the applied model.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "prepare_psd_input", description: "Validate and preview a random INPUT PSD using a table, explicit-metadata CSV, or band-limited white-noise template. Returns canonical one-sided Hz input and physical variance, never response. No project mutation. Then propose_model_edits create/update_psd_spectrum properties=canonical and get user confirmation. PSD metadata carries its own units independently of inputUnits. Missing units must be clarified, never guessed.", parameters: PSD_PREPARATION_SCHEMA } },
  { type: "function", function: { name: "read_model", description: "Read the applied model identity, engineering revision, analysis context, summary or a paginated collection. All values come from the current model snapshot; collection reads support bounded fields/query filtering.",
    parameters: { type: "object", properties: {
      collection: { type: "string", enum: ["summary", "nodes", "members", "materials", "sections", "supports", "loads", "load-cases", "analysis-cases", "psd-spectra"] },
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, fields: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
      query: { type: "object", additionalProperties: false, required: ["field"], properties: { field: { type: "string" }, equals: {}, min: { type: "number" }, max: { type: "number" } } },
    }, required: ["collection"], additionalProperties: false } } },
  { type: "function", function: { name: "read_selection", description: "Read the selected nodes and members using stable object identifiers.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_objects", description: "Read actual nodes or members by stable identifiers. This tool cannot change the model.",
    parameters: { type: "object", properties: { objects: { type: "array", minItems: 1, maxItems: 100,
      items: { type: "object", properties: { kind: { type: "string", enum: ["node", "member"] }, id: { type: "string" } }, required: ["kind", "id"], additionalProperties: false },
    } }, required: ["objects"], additionalProperties: false } } },
  { type: "function", function: { name: "propose_frame", description: "Create or update an unapplied parameter card and batch preview for an orthogonal spatial frame. Missing fields remain missing. Never applies changes.",
    parameters: { type: "object", properties: { parameters: { type: "object", additionalProperties: false,
      properties: Object.fromEntries(["storeys", "xSpans", "ySpans", "storeyHeights", "origin", "material", "columnSection", "beamSection", "rotationDegrees"].map((name) => [name, {
        type: "object", additionalProperties: false, required: ["value", "source"], properties: {
          value: ["material", "columnSection", "beamSection"].includes(name) ? { type: "string" }
            : name === "storeys" ? { type: "integer", minimum: 1, maximum: 100 }
            : name === "rotationDegrees" ? { type: "number" } : { type: "array", items: { type: "number" }, minItems: 1, maxItems: 100 },
          source: { type: "string", enum: ["existing", "user", "catalog", "suggestion", "assumption", "unknown"] }, replace: { type: "boolean", description: "Only true for an explicit user correction or clarification." },
        },
      }])) } }, required: ["parameters"], additionalProperties: false } } },
  { type: "function", function: { name: "discard_analysis_conditions", description: "Discard unapplied analysis conditions, loads, cases and combinations. Keeps confirmed work.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "propose_analysis_conditions", description: "Preview supports, nodal force/moment, full-member uniform force, self weight, load cases and USER-DEFINED combinations. New cases/combinations use unique ref aliases, resolved only at confirmation. Partial updates retain other stage fields. Does not apply or solve.",
    parameters: { type: "object", additionalProperties: false, properties: { ...LOAD_STAGE_SCHEMA, analysisSourceId: { type: "string", description: "Existing case/combination ID or draft ref to select and calculate after confirmation. If omitted, a single proposed load case is selected; otherwise current source is retained." }, ...Object.fromEntries(["supports", "nodalLoads"].map((key) => [key, {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: key === "supports" ? ["nodeId", "restraints", "source"] : ["nodeId", "loadCaseId", "force", "moment", "source"],
        properties: { id: { type: "string", description: "Existing condition ID for updates; omit to create." }, nodeId: { type: "string" }, source: { type: "string", enum: ["user", "suggestion"] },
          ...(key === "supports" ? { restraints: { type: "array", minItems: 6, maxItems: 6, items: { type: "boolean" }, description: "UX UY UZ RX RY RZ; true means restrained." } }
            : { loadCaseId: { type: "string" }, ...Object.fromEntries(["force", "moment"].map((kind) => [kind, { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: kind === "force" ? "Global XYZ kN" : "Global XYZ kN*m right hand rule" }])) }),
        },
      },
    }])) } } } },
];
const taskFrameParameterSchema = {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(["storeys", "xSpans", "ySpans", "storeyHeights", "origin", "material", "columnSection", "beamSection", "rotationDegrees"].map((name) => [name, {
    type: "object", additionalProperties: false, required: ["value", "source"], properties: {
      value: ["material", "columnSection", "beamSection"].includes(name) ? { type: "string" }
        : name === "storeys" ? { type: "integer", minimum: 1, maximum: 100 }
        : name === "rotationDegrees" ? { type: "number" } : { type: "array", items: { type: "number" }, minItems: 1, maxItems: 100 },
      source: { type: "string", enum: ["existing", "user", "catalog", "suggestion", "assumption", "unknown"] },
      replace: { type: "boolean", description: "Only true for an explicit user correction or clarification." },
    },
  }])),
};
const taskToolDefinitions = [
  { type: "function", function: { name: "propose_task", description: "Prepare one unapplied whole-task draft containing geometry/resources, supports, loads and analysis intent. Existing model values are retained when omitted; new frame object references may be used by supports and loads. Never applies or solves.", parameters: {
    type: "object", additionalProperties: false, properties: {
      goal: { type: "string", maxLength: 2000 },
      frame: { type: "object", additionalProperties: false, required: ["parameters"], properties: { parameters: taskFrameParameterSchema } },
      parameters: taskFrameParameterSchema,
      supports: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["nodeId", "restraints", "source"], properties: {
        id: { type: "string" }, nodeId: { type: "string" }, restraints: { type: "array", minItems: 6, maxItems: 6, items: { type: "boolean" } },
        source: { type: "string", enum: ["existing", "user", "catalog", "suggestion", "assumption", "unknown"] },
      } } },
      nodalLoads: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["nodeId", "loadCaseId", "force", "moment", "source"], properties: {
        id: { type: "string" }, nodeId: { type: "string" }, loadCaseId: { type: "string" },
        force: { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        moment: { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        source: { type: "string", enum: ["existing", "user", "catalog", "suggestion", "assumption", "unknown"] },
      } } },
      ...LOAD_STAGE_SCHEMA,
      analysis: { type: "object", additionalProperties: false, required: ["requested", "source"], properties: {
        requested: { type: "boolean" }, sourceId: { type: "string", maxLength: 200 },
        source: { type: "string", enum: ["existing", "user", "catalog", "suggestion", "assumption", "unknown"] },
      } }, analysisRequested: { type: "boolean" },
    },
  } } },
  { type: "function", function: { name: "discard_task_draft", description: "Discard the unapplied whole-task draft without changing the applied model.", parameters: { type: "object", additionalProperties: false, properties: {} } } },
];
const modelEditTools = [
  { type: "function", function: { name: "propose_model_edits", description: "Random cases: method=random, loadSourceId=random, settings={solver:native-random,random: explicit RANDOM_SETTINGS_SCHEMA fields}. Legacy one-node force settings or distributed sources: sourceRelationship=independent, sources=[{sourceId,psdSpectrumId,actions:[{kind:node,nodeId,direction,scale}|{kind:member-uniform,memberId,direction,scalePerM}]}]. Direction is global XYZ unit vector; node scale dimensionless, whole-member uniform scalePerM canonical 1/m (inputUnits.inverseLength accepts 1/mm). Same-source actions share one process: sum signed transfers before squaring. Different sourceIds are independent even with the same PSD: add PSD then integrate and square-root, never add RMS. All source spectra share the same complete band. Latest converged modal identity and reviewed damping required. No base, local/partial-member loads, phase, partial correlation or cross spectra. Use read_results summary/psd and read_result rms; statistical RMS is not a peak. Preview one atomic batch including set_modal_damping {id:analysisCaseId,analysisId:latest current modal result,properties:{uniform:{ratio:(0,1),source:user|suggestion,basis:nonempty text},overrides:[{modeNumber,value:{ratio,source,basis}}],truncation:{upperFrequencyHz:positive Hz,modeIncrement:1..50,maxModeCount:current requested count..50}}}. Ratio 0.02 means 2 percent. AI assumptions use source=suggestion and state their basis, never pretend the user specified them. Binding is to the exact result identity and order; recomputation requires re-reading shapes/frequencies and a new confirmed edit. No Rayleigh or automatic default damping. Increase modal count using update_analysis_case and request_analysis; response accuracy remains unverified. Preview one atomic batch including create_section/update_section (properties {name,catalogId} selects a checked standard catalog and preserves original mechanics; properties name plus geometry: rectangle width/height, circle diameter, rectangular-tube width/height/thickness, circular-tube diameter/thickness, i-section width/height/webThickness/flangeThickness; dimensions m unless inputUnits declares length). J uses documented idealized thin-wall approximations for tubes/I. duplicate_section copies a stable section id; assign_section uses id, explicit memberIds and optional rotationDegrees; edits affect all shared references and require review. Member create/update properties support optional endReleases={start:{my:boolean,mz:boolean},end:{my:boolean,mz:boolean}} in local axes, independent of global support restraints; omission is rigid. No torsion/axial/shear releases. Explicit additional mass: set_node_mass {id,massKg} and update_member changes {additionalLineMassKgM}. Nonnegative scalars, kg and kg/m (inputUnits mass/lineMass allowed); isotropic translations only, no rotary inertia or static gravity conversion. Duplicate inherits, split retains line intensity, deletion removes attached mass. Second-order cases: method=second-order, loadSourceId=LC or CB, settings={solver:native-second-order,secondOrder:{loadSteps:1..100,maxIterations:1..100,residualTolerance:(0,1e-6],incrementTolerance:(0,1e-6],maxDivisions:1|2|4|8|16,maxEquations:1..1200,meshTolerance:(0,0.01]}}. Small-displacement initial-stress elastic approximation (K+alpha*G[Nlinear])u=alpha*F; axial force is from the same frozen linear load, with P-Delta/P-delta effects but no axis update or axial redistribution, no large rotation/material nonlinearity/follower loads/postbuckling. Loading records are actual equilibrium corrections of a fixed matrix per step. Unstable tangent, iteration/mesh nonconvergence, scope or resource limits fail without publishing partial results. Compare ONLY identical base inputs and mesh. No response superposition or static process reconstruction. Read summary/mesh/nodes/members for actual second-order identity, convergence, linear baseline and responses. Buckling cases: method=buckling, loadSourceId=buckling, settings={solver:native-buckling,buckling:{fixed:[{loadCaseId:LC id,factor:finite}],reference:[{loadCaseId:LC id,factor:finite}],modeCount:1..20,maxDivisions:1|2|4|8|16,maxEquations:1..1200,factorTolerance:(0,0.01]}}. Fixed terms may be empty; reference must have a nonzero coefficient. Separate dead loads: fixed + lambda times reference. Read summary/modes/mesh for factors, frozen sources, signs, coefficients, prestress and convergence. Lambda amplifies ONLY reference, never a uniform safety factor, ultimate capacity or code compliance. Shapes are normalized/display-only, not actual displacements. Do not superpose buckling factors or use static force/displacement tools on shapes. Stable elastic base required; axial-force geometric stiffness excludes follower loads, torsional prestress, material nonlinearity and postbuckling. Modal analysis cases: method=modal, loadSourceId=structure, settings={solver:native-modal,modal:{modeCount:1..50,maxDivisions:1|2|4|8|16,maxEquations:1..1200,frequencyTolerance:(0,0.01]}}. Modal cases use structural density mass, not static load definitions or self-weight; no mesh setting. Also supports node/member edits and create/update/delete_analysis_case operations (properties: name, method=static, loadSourceId=LC or CB, settings={solver:native-static,mesh?:{maxDivisions:1|2|4|8|16,maxEquations:1..12000,relativeTolerance,displacementTolerance,forceTolerance}}) using stable formal IDs. Never applies directly; user confirms the draft.", parameters: MODEL_EDIT_SCHEMA } },
  { type: "function", function: { name: "discard_model_edits", description: "Discard the pending basic-edit draft without changing the formal model.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  ...MODEL_EDIT_TOOL_DEFINITIONS,
];
function toolsForMessages(messages: readonly DeepSeekChatMessage[]) {
  const psdEditRequested = messages.some((message) => message.role === "user" && /PSD|输入谱|随机.*谱|谱密度|白噪声|power spectral density/i.test(message.content));
  const editRequested = messages.some((message) => message.role === "user" && /(?:矩形管|圆管|实心矩形|实心圆|参数.*截面|指派.*截面|截面.*指派)/i.test(message.content)) || messages.some((message) => message.role === "user" && /(?:\u5408\u5e76.*\u8282\u70b9|\u8282\u70b9.*\u5408\u5e76|merge.*node|node.*merge)/i.test(message.content)) || messages.some((message) => message.role === "user" && /绘杆|画杆|工作平面|自由坐标|自由数值|斜杆|基础编辑|批量|移到|转角|旋转|(?:(?:建立|创建|新增|修改|编辑|更新|移动|复制|删除|调整|设置|改变|变更|改为|改成).*(?:节点|杆件|坐标|材料|截面|支座|荷载|转角|点|梁|柱)|(?:节点|杆件|坐标|材料|截面|支座|荷载|转角|点|梁|柱).*(?:建立|创建|新增|修改|编辑|更新|移动|复制|删除|调整|设置|改变|变更|改为|改成))|(?:draw|edit|move|delete|copy|create|update|modify|duplicate).*(?:node|member|section)|(?:node|member|section).*(?:draw|edit|move|delete|copy|create|update|modify|duplicate)/i.test(message.content));
  const taskDraftActive = messages.some((message) => message.role === "system" && /当前完整任务草案：\{/.test(message.content));
  const taskRequested = taskDraftActive || messages.some((message) => message.role === "user" && /完整任务|整体草案|一次确认|集中补齐|(?:(?:建立|创建|建模|几何|框架|刚架|节点|杆件|材料|截面).*(?:支座|荷载|自重|工况|组合|计算)|(?:支座|荷载|自重|工况|组合|计算).*(?:建立|创建|建模|几何|框架|刚架|节点|杆件|材料|截面))/i.test(message.content));
  const base = taskRequested ? [...modelTools, ...taskToolDefinitions] : modelTools;
  return (editRequested || psdEditRequested ? [...base, ...modelEditTools] : base).map((tool) => {
    if (tool.function.name.startsWith("discard_") || ["request_analysis", "read_unit_contract", "read_geometry_contract", "convert_quantity"].includes(tool.function.name)) return tool;
    return { ...tool, function: { ...tool.function,
      description: tool.function.description + " Numeric fields use canonical m, kN, kN·m, GPa, kg/m³, m², m⁴, degrees (orientation), rad (response), m/s² unless inputUnits explicitly overrides dimensions. External values with missing units require user clarification. outputUnitPreset changes returned data only; confirmation and reference payloads remain canonical.",
      parameters: { ...tool.function.parameters, properties: { ...tool.function.parameters.properties,
        inputUnits: { type: "object", additionalProperties: false, properties: Object.fromEntries(["length", "force", "moment", "distributedForce", "modulus", "density", "area", "inertia", "orientation", "rotation", "acceleration", "mass", "lineMass", "inverseLength"].map((key) => [key, { type: "string" }])) },
        outputUnitPreset: { type: "string", enum: ["m-kN", "mm-N", "mm-kN"] },
      } },
    } };
  });
}
const MAX_CHAT_BYTES = 1_048_576;
const MAX_TOOL_CALLS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
function parseToolCall(value: unknown, allowResponseIndex: boolean): DeepSeekToolCall | null {
  if (!isRecord(value) || !hasOnlyKeys(value, allowResponseIndex ? ["id", "type", "function", "index"] : ["id", "type", "function"])
    || allowResponseIndex && value.index !== undefined && (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0)
    || !isIdentifier(value.id)
    || value.type !== "function" || !isRecord(value.function) || !hasOnlyKeys(value.function, ["name", "arguments"])
    || typeof value.function.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.function.name)
    || typeof value.function.arguments !== "string" || Buffer.byteLength(value.function.arguments) > 16_384) return null;
  return { id: value.id, type: "function", function: { name: value.function.name, arguments: value.function.arguments } };
}
function parseAssistant(value: unknown, strictKeys = false): DeepSeekAssistantMessage | null {
  if (!isRecord(value) || value.role !== "assistant" || value.content !== null && typeof value.content !== "string"
    || strictKeys && !hasOnlyKeys(value, ["role", "content", "tool_calls"])) return null;
  let toolCalls: DeepSeekToolCall[] | undefined;
  if (value.tool_calls !== undefined && value.tool_calls !== null) {
    if (!Array.isArray(value.tool_calls) || value.tool_calls.length === 0 || value.tool_calls.length > MAX_TOOL_CALLS) return null;
    // DeepSeek may attach index metadata even to non-streaming tool calls; omit it from replay.
    const parsed = value.tool_calls.map((call) => parseToolCall(call, !strictKeys));
    if (parsed.some((call) => !call) || new Set(parsed.map((call) => call!.id)).size !== parsed.length) return null;
    toolCalls = parsed as DeepSeekToolCall[];
  }
  if (!toolCalls && (typeof value.content !== "string" || !value.content.trim())) return null;
  return { role: "assistant", content: value.content, ...(toolCalls ? { tool_calls: toolCalls } : {}) };
}
function parseChatRequest(value: unknown): DeepSeekChatRequest | null {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, ["requestId", "messages"]) || !isIdentifier(value.requestId)
      || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 100
      || Buffer.byteLength(JSON.stringify(value)) > MAX_CHAT_BYTES) return null;
    const result: DeepSeekChatMessage[] = [];
    const pending = new Set<string>();
    const used = new Set<string>();
    for (const message of value.messages) {
      if (!isRecord(message)) return null;
      if (message.role === "tool") {
        if (!hasOnlyKeys(message, ["role", "content", "tool_call_id"]) || typeof message.content !== "string"
          || !message.content || !isIdentifier(message.tool_call_id) || !pending.delete(message.tool_call_id)) return null;
        result.push({ role: "tool", content: message.content, tool_call_id: message.tool_call_id });
      } else {
        if (pending.size) return null;
        if (message.role === "assistant") {
          const assistant = parseAssistant(message, true);
          if (!assistant) return null;
          for (const call of assistant.tool_calls ?? []) {
            if (used.has(call.id)) return null;
            used.add(call.id); pending.add(call.id);
          }
          result.push(assistant);
        } else if ((message.role === "user" || message.role === "system") && hasOnlyKeys(message, ["role", "content"])
          && typeof message.content === "string" && message.content.trim()) {
          result.push({ role: message.role, content: message.content });
        } else return null;
      }
    }
    return pending.size ? null : { requestId: value.requestId, messages: result };
  } catch { return null; }
}
async function readAssistant(response: Response, apiKey: string, signal: AbortSignal): Promise<DeepSeekAssistantMessage | null> {
  if (!response.body) return null;
  if (Number(response.headers.get("content-length")) > MAX_CHAT_BYTES) {
    void response.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CHAT_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (text.includes(apiKey)) return null;
    const value = JSON.parse(text);
    const assistant = parseAssistant(value?.choices?.[0]?.message);
    return assistant && !JSON.stringify(assistant).includes(apiKey) ? assistant : null;
  } catch { return null; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

const messages: Record<DeepSeekStatus, string> = {
  saved: "连接设置已保存", removed: "本机凭据已移除", success: "连接成功",
  "not-configured": "尚未配置 DeepSeek API Key",
  "invalid-input": "请选择支持的模型，并填写有效的 API Key",
  "storage-unavailable": "本机安全存储不可用，无法保存或读取凭据",
  "storage-error": "无法读取或写入本机凭据，请重新保存或移除凭据",
  authentication: "认证失败，请检查或更新 API Key", balance: "DeepSeek 账户余额不足",
  "rate-limit": "请求受到限流，请稍后重试", timeout: "连接测试超时，请稍后重试",
  network: "网络连接失败，请检查网络后重试", service: "DeepSeek 服务暂不可用，请稍后重试",
  "invalid-response": "DeepSeek 返回了无法识别的响应", cancelled: "连接设置已改变，此次测试已失效",
};
function isModel(value: unknown): value is DeepSeekModel {
  return DEEPSEEK_MODELS.some((model) => model === value);
}
function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value);
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class DeepSeekConnection {
  private queue: Promise<unknown> = Promise.resolve();
  private activeTest: AbortController | null = null;
  private activeChats = new Map<string, AbortController>();

  constructor(private readonly path: string, private readonly encryption: CredentialEncryption,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init), private readonly timeoutMs = 15_000) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private available(): boolean {
    try { return this.encryption.isAvailable(); } catch { return false; }
  }

  private abortChats(): void {
    for (const controller of this.activeChats.values()) controller.abort();
    this.activeChats.clear();
  }

  private async read(): Promise<StoredSettings> {
    const settings: DeepSeekSettings = { configured: false, model: "deepseek-flash", storageAvailable: this.available() };
    try {
      const bytes = await readFile(this.path);
      if (!settings.storageAvailable) return { settings: { ...settings, issue: "storage-unavailable" } };
      const value = JSON.parse(this.encryption.decrypt(bytes));
      if (value?.version !== 1 || !isModel(value.model) || !isKey(value.apiKey)) throw new Error("Invalid credential");
      return { settings: { ...settings, configured: true, model: value.model }, credential: value };
    } catch (error) {
      return { settings: isMissing(error) ? settings : { ...settings, issue: "storage-error" } };
    }
  }

  private result(status: DeepSeekStatus, settings: DeepSeekSettings): DeepSeekResult {
    return { status, message: messages[status], settings };
  }

  getSettings(): Promise<DeepSeekSettings> {
    return this.serial(async () => (await this.read()).settings);
  }

  save(request: unknown): Promise<DeepSeekResult> {
    return this.serial(async () => {
      const current = await this.read();
      if (typeof request !== "object" || request === null || !("model" in request) || !("apiKey" in request)
        || !isModel(request.model) || typeof request.apiKey !== "string") return this.result("invalid-input", current.settings);
      const apiKey = request.apiKey.trim() || current.credential?.apiKey;
      if (!isKey(apiKey)) return this.result("invalid-input", current.settings);
      if (!this.available()) return this.result("storage-unavailable", current.settings);
      const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
      try {
        const credential: Credential = { version: 1, model: request.model, apiKey };
        const encrypted = this.encryption.encrypt(JSON.stringify(credential));
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
        await rename(temporaryPath, this.path);
        this.activeTest?.abort();
        this.activeTest = null;
        this.abortChats();
        return this.result("saved", { configured: true, model: request.model, storageAvailable: true });
      } catch {
        return this.result("storage-error", current.settings);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    });
  }

  remove(): Promise<DeepSeekResult> {
    return this.serial(async () => {
      try { await unlink(this.path); }
      catch (error) { if (!isMissing(error)) return this.result("storage-error", (await this.read()).settings); }
      this.activeTest?.abort();
      this.activeTest = null;
      this.abortChats();
      return this.result("removed", (await this.read()).settings);
    });
  }

  async chat(input: unknown): Promise<DeepSeekChatResult> {
    const result = (status: DeepSeekStatus): DeepSeekChatResult => ({ status, message: status === "success" ? "AI 响应已接收"
      : status === "invalid-input" ? "AI 请求格式无效或超出限制"
      : status === "cancelled" ? "AI 请求已取消" : status === "timeout" ? "AI 请求超时，请稍后重试" : messages[status] });
    const request = parseChatRequest(input);
    if (!request) return result("invalid-input");
    const { settings, credential, controller } = await this.serial(async () => {
      this.activeChats.get(request.requestId)?.abort();
      const controller = new AbortController();
      this.activeChats.set(request.requestId, controller);
      return { ...await this.read(), controller };
    });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
      if (controller.signal.aborted) return result("cancelled");
      if (!credential) return result(settings.issue ?? "not-configured");
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error("Aborted"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      });
      const performRequest = async (): Promise<DeepSeekChatResult> => {
        const response = await this.fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
          body: JSON.stringify({ model: credential.model, messages: request.messages, tools: toolsForMessages(request.messages),
            tool_choice: "auto", thinking: { type: "disabled" }, stream: false, max_tokens: 2048 }),
        });
        if (controller.signal.aborted || !response.ok) {
          void response.body?.cancel().catch(() => undefined);
          return result(controller.signal.aborted ? "cancelled"
            : response.status === 401 || response.status === 403 ? "authentication"
            : response.status === 402 ? "balance" : response.status === 429 ? "rate-limit"
            : [400, 404, 422].includes(response.status) ? "invalid-response" : "service");
        }
        const assistant = await readAssistant(response, credential.apiKey, controller.signal);
        if (!assistant) return result("invalid-response");
        return { ...result("success"), assistant };
      };
      const response = await Promise.race([performRequest(), aborted]);
      return controller.signal.aborted ? result(timedOut ? "timeout" : "cancelled") : response;
    } catch {
      return result(controller.signal.aborted ? timedOut ? "timeout" : "cancelled" : "network");
    } finally {
      clearTimeout(timer);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      if (this.activeChats.get(request.requestId) === controller) this.activeChats.delete(request.requestId);
    }
  }

  cancelChat(requestId: unknown): Promise<void> {
    return this.serial(async () => {
      if (isIdentifier(requestId)) this.activeChats.get(requestId)?.abort();
    });
  }

  async testConnection(): Promise<DeepSeekResult> {
    const snapshot = await this.serial(async () => {
      const stored = await this.read();
      this.activeTest?.abort();
      const controller = new AbortController();
      this.activeTest = controller;
      return { ...stored, controller };
    });
    const { settings, credential, controller } = snapshot;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!credential) return this.result(settings.issue ?? "not-configured", settings);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      });
      const request = async (): Promise<DeepSeekStatus> => {
        const response = await this.fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
          body: JSON.stringify({ model: credential.model, messages: [{ role: "user", content: "Reply OK." }],
            thinking: { type: "disabled" }, stream: false, max_tokens: 8 }),
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          switch (response.status) {
            case 401: case 403: return "authentication";
            case 402: return "balance";
            case 429: return "rate-limit";
            case 400: case 404: case 422: return "invalid-response";
            default: return "service";
          }
        }
        try {
          const data = await response.json();
          const message = data?.choices?.[0]?.message;
          return message?.role === "assistant" && typeof message.content === "string" && message.content.trim()
            ? "success" : "invalid-response";
        } catch { return "invalid-response"; }
      };
      const status = await Promise.race([request(), aborted]);
      if (this.activeTest !== controller) return this.result("cancelled", await this.getSettings());
      return this.result(status, settings);
    } catch {
      if (this.activeTest !== controller) return this.result("cancelled", await this.getSettings());
      return this.result(timedOut ? "timeout" : "network", settings);
    } finally {
      clearTimeout(timer);
      if (this.activeTest === controller) this.activeTest = null;
    }
  }
}
