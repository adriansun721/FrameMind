import { getMemberSectionForces, getOverallAnalysisProcessRecord, solveFrame, type AnalysisResult } from "../domain/analysis";
import { addLoadCase, addLoadCombination, addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, addUniformLoad, createProject, selectLoadCase, selectLoadCombination, updateSelfWeight, type FrameProject, type Vector3 } from "../domain/project";
import { AnalysisFailure } from "../domain/analysis-diagnostics";
import references from "./t31-references.json";

export type NumericalBenchmark = typeof references.cases[number];
type Unit = "m" | "rad" | "kN" | "kN·m";
export interface NumericalCheck {
  quantity: string;
  unit: Unit;
  actual: number;
  reference: number;
  absoluteError: number;
  relativeError: number | null;
  tolerance: number;
  passed: boolean;
}
const absoluteTolerance: Record<Unit, number> = { m: 1e-11, rad: 1e-11, kN: 1e-9, "kN·m": 1e-9 };
const xyz = (v: Vector3) => [v.x, v.y, v.z];
const vector = (v: number[]): Vector3 => ({ x: v[0], y: v[1], z: v[2] });
const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function makeProject(benchmark: NumericalBenchmark): FrameProject {
  const { input } = benchmark;
  let p = createProject(`T31 ${benchmark.id}`);
  const aliases: Partial<Record<string, number>> = input.aliases;
  for (const [i, position] of input.points.entries()) if (!(String(i) in aliases)) p = addNode(p, vector(position));
  const mat = input.material;
  p = addMaterial(p, { name: "Independent benchmark material", elasticModulusGPa: mat.E, poissonRatio: mat.nu, densityKgM3: mat.rho });
  p = addSection(p, { name: "Independent benchmark section", areaM2: mat.A, secondMomentYM4: mat.Iy, secondMomentZM4: mat.Iz, torsionalConstantM4: mat.J });
  const nodeId = (i: number) => p.nodes[aliases[String(i)] ?? i].id;
  for (let i = 0; i < input.points.length - 1; i++) p = addMember(p, { startNodeId: nodeId(i), endNodeId: nodeId(i+1), materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: input.rotation });
  p = addSupport(p, p.nodes[0].id, [true,true,true,true,true,true]);
  if (input.fixedTip && !Object.keys(aliases).length) p = addSupport(p, p.nodes.at(-1)!.id, [true,true,true,true,true,true]);
  if (input.factors || benchmark.id === "case-LC1" || benchmark.id === "case-LC2") {
    p = addLoadCase(p, "Independent LC2");
    p = addNodalLoad(p, nodeId(1), {x:10,y:12,z:14}, {x:2,y:3,z:4}, "LC1");
    p = addNodalLoad(p, nodeId(1), {x:-4,y:6,z:-8}, {x:-1,y:2,z:-3}, "LC2");
    p = addUniformLoad(p, { kind:"uniform", memberId:p.members[0].id, coordinateSystem:"global", loadCaseId:"LC2", intensity:{x:1,y:-3,z:2} });
    p = updateSelfWeight(p, { enabled:true, loadCaseId:"LC2", gravity:{x:0,y:0,z:-9.81} });
    if (!input.factors) return selectLoadCase(p, benchmark.id === "case-LC1" ? "LC1" : "LC2");
    p = addLoadCombination(p, "Independent combination", input.factors.map((factor, i) => ({ loadCaseId:`LC${i+1}`, factor })));
    return selectLoadCombination(p, p.loadCombinations[0].id);
  }
  for (const load of input.loads) p = addNodalLoad(p, nodeId(load.node), vector(load.force), vector(load.moment));
  if (input.selfWeight) return updateSelfWeight(p, { enabled:true, loadCaseId:"LC1", gravity:{x:0,y:0,z:-9.81} });
  for (const [i, q] of input.uniform.entries()) if (q.some((v) => v !== 0)) p = addUniformLoad(p, { kind:"uniform", memberId:p.members[i].id, coordinateSystem:benchmark.id === "uniform-local" ? "local" : "global", loadCaseId:"LC1", intensity:vector(q) });
  return p;
}

function check(quantity: string, unit: Unit, actual: number, reference: number, absoluteOnly = false): NumericalCheck {
  const absoluteError = Math.abs(actual - reference);
  const tolerance = absoluteOnly ? absoluteTolerance[unit] : Math.max(absoluteTolerance[unit], 1e-8 * Math.abs(reference));
  return { quantity, unit, actual, reference, absoluteError, relativeError: Math.abs(reference) <= absoluteTolerance[unit] ? null : absoluteError / Math.abs(reference), tolerance, passed: Number.isFinite(actual) && Number.isFinite(reference) && absoluteError <= tolerance };
}

/** Validation-only adapter around the three agreed public analysis boundaries. */
export function runNumericalBenchmark(benchmark: NumericalBenchmark) {
  const project = makeProject(benchmark);
  const result = solveFrame(project);
  if (result.nodes.length !== benchmark.reference.nodes.length || result.members.length !== benchmark.reference.members.length) throw new Error("Incomplete result object set");
  const checks: NumericalCheck[] = [];
  for (const [i, inputNode] of result.input.nodes.entries()) {
    const node = result.nodes.find((n) => n.nodeId === inputNode.id);
    if (!node) throw new Error(`Missing node ${inputNode.id}`);
    const reference = benchmark.reference.nodes[i];
    for (const [field, expected, unit] of [
      ["displacement", reference.response.slice(0,3), "m"], ["rotation", reference.response.slice(3), "rad"],
      ["reaction", reference.reaction.slice(0,3), "kN"], ["reactionMoment", reference.reaction.slice(3), "kN·m"],
    ] as const) xyz(node[field]).forEach((actual, k) => checks.push(check(`${node.nodeId}.${field}.${["x","y","z"][k]}`, unit, actual, expected[k])));
  }
  for (const [i, inputMember] of result.input.members.entries()) {
    const member = result.members.find((m) => m.memberId === inputMember.id);
    if (!member) throw new Error(`Missing member ${inputMember.id}`);
    const expected = benchmark.reference.members[i];
    for (const end of ["start","end"] as const) {
      if (member.localEndForces[end].length !== 6 || expected[end].length !== 6) throw new Error(`Incomplete end force vector ${member.memberId}.${end}`);
      expected[end].forEach((reference,k) => checks.push(check(`${member.memberId}.${end}.${k}`, k<3 ? "kN" : "kN·m", member.localEndForces[end][k], reference)));
    }
    for (const station of expected.stations) {
      const actual=getMemberSectionForces(result, member.memberId, station.position).forces;
      if (actual.length !== 6 || station.forces.length !== 6) throw new Error(`Incomplete section force vector ${member.memberId}@${station.position}`);
      station.forces.forEach((reference,k) => checks.push(check(`${member.memberId}.section@${station.position}.${k}`, k<3 ? "kN" : "kN·m", actual[k], reference)));
    }
    for (const [axisIndex, axis] of ["x","y","z"].entries()) xyz(member.localAxes[axis as keyof typeof member.localAxes]).forEach((actual,k) => {
      if (Math.abs(actual - benchmark.input.axes[i][axisIndex][k]) > 1e-12) throw new Error(`Local axis mismatch ${member.memberId}.${axis}`);
    });
  }
  const balance = globalBalance(result, benchmark);
  balance.forEach((actual,k) => checks.push(check(`equilibrium.${k}`, k < 3 ? "kN" : "kN·m", actual, 0, true)));
  verifyProcess(result, benchmark, checks);
  return { id:benchmark.id, source:benchmark.source, passed:checks.every((item) => item.passed), input:result.input, actual:{nodes:result.nodes,members:result.members}, checks };
}

export function runInvalidBenchmarks() {
  const cases: Array<{ id:string; stage:"model-check" | "solve"; code:string; field?:string; change:(p:FrameProject) => FrameProject }> = [
    { id:"missing-parameter", stage:"model-check", code:"invalid-parameter", field:"elasticModulusGPa", change:p => { Reflect.deleteProperty(p.materials[0], "elasticModulusGPa"); return p; } },
    { id:"zero-length", stage:"model-check", code:"invalid-geometry", field:"endNodeId", change:p => { p.nodes[1].position = {...p.nodes[0].position}; return p; } },
    { id:"invalid-reference", stage:"model-check", code:"invalid-reference", field:"materialId", change:p => ({...p,materials:[]}) },
    { id:"isolated-node", stage:"model-check", code:"isolated-node", field:"connectivity", change:p => addNode(p,{x:8,y:0,z:0}) },
    { id:"disconnected-unrestrained", stage:"model-check", code:"unrestrained-component", change:p => {
      p=addNode(p,{x:0,y:4,z:0}); p=addNode(p,{x:4,y:4,z:0});
      const {materialId,sectionId,rotationDegrees}=p.members[0];
      return addMember(p,{materialId,sectionId,rotationDegrees,startNodeId:p.nodes[2].id,endNodeId:p.nodes[3].id});
    } },
    { id:"no-support", stage:"model-check", code:"unrestrained-component", change:p => ({...p,supports:[]}) },
    { id:"rotational-mechanism", stage:"solve", code:"singular-system", change:p => { p.supports[0].restraints=[true,true,true,false,false,false]; return p; } },
  ];
  return cases.map(({id,stage,code,field,change}) => {
    const project=change(makeProject(references.cases[0]));
    const before=JSON.stringify(project);
    try {
      const result=solveFrame(project);
      return {id,passed:false,input:project,expected:{stage,code,field},actual:{status:result.status},preserved:before===JSON.stringify(project)};
    } catch(error) {
      const diagnostic=error instanceof AnalysisFailure ? error.diagnostics.find(d => d.code===code && (!field || d.field===field)) : undefined;
      const preserved=before===JSON.stringify(project);
      return {id,passed:error instanceof AnalysisFailure && error.stage===stage && !!diagnostic?.target && (stage!=="solve" || !!diagnostic.dof && !!diagnostic.evidence) && preserved,input:project,expected:{stage,code,field},actual:error instanceof AnalysisFailure ? {stage:error.stage,diagnostics:error.diagnostics} : {message:String(error)},preserved};
    }
  });
}

function globalBalance(result: AnalysisResult, benchmark: NumericalBenchmark): number[] {
  const balance = [0,0,0,0,0,0];
  const accumulate = (position: number[], force: number[], moment: number[]) => {
    const lever = cross(position, force);
    for (let k=0; k<3; k++) { balance[k] += force[k]; balance[k+3] += lever[k] + moment[k]; }
  };
  for (const node of result.nodes) accumulate(xyz(result.input.nodes.find((n) => n.id === node.nodeId)!.position), xyz(node.reaction), xyz(node.reactionMoment));
  // Physical external loads from the registered reference input, independent of
  // product equivalent-node load vectors (including weighted self-weight).
  for (const load of benchmark.input.loads) accumulate(benchmark.input.points[load.node], load.force, load.moment);
  for (const [i, q] of benchmark.input.uniform.entries()) {
    const a = benchmark.input.points[i], b = benchmark.input.points[i+1];
    const length = Math.hypot(...a.map((v,k) => b[k]-v));
    accumulate(a.map((v,k) => (v+b[k])/2), q.map((v) => v*length), [0,0,0]);
  }
  return balance;
}

function verifyProcess(result: AnalysisResult, benchmark: NumericalBenchmark, checks: NumericalCheck[]) {
  const process = getOverallAnalysisProcessRecord(result);
  if (process.analysisId !== result.id || process.origin !== "captured-from-run" || !process.assembledStiffness) throw new Error("Missing actual run process");
  const size=result.input.nodes.length*6;
  if (process.dofs.length !== size || new Set(process.dofs.map(d => d.globalIndex)).size !== size || process.dofs.some(d => !Number.isInteger(d.globalIndex) || d.globalIndex<0 || d.globalIndex>=size) || process.loadVector.length !== size || process.assembledStiffness.length !== size || process.assembledStiffness.some(row => row.length !== size)) throw new Error("Incomplete actual DOF/matrix record");
  const displacement = result.input.nodes.flatMap((inputNode) => {
    const node = result.nodes.find((n) => n.nodeId === inputNode.id)!;
    return [...xyz(node.displacement),...xyz(node.rotation)];
  });
  for (const dof of process.dofs) {
    const i = dof.globalIndex;
    if (result.input.nodes[Math.floor(i/6)].id !== dof.nodeId || result.input.dofOrder[i%6] !== dof.dof) throw new Error("Incorrect actual DOF mapping");
    const node = result.nodes.find((n) => n.nodeId === dof.nodeId)!;
    const actual = process.assembledStiffness[i].reduce((sum,k,j) => sum+k*displacement[j], -process.loadVector[i]);
    checks.push(check(`process.residual.${i}`, i%6<3 ? "kN" : "kN·m", actual, [...xyz(node.reaction),...xyz(node.reactionMoment)][i%6]));
  }
  // Compare captured equivalent loads with physical external resultants, not
  // just with another view of the same process snapshot.
  const loadBalance = globalBalance({ ...result, nodes:result.nodes.map((node,i) => ({...node,reaction:vector(process.loadVector.slice(i*6,i*6+3).map(v => -v)),reactionMoment:vector(process.loadVector.slice(i*6+3,i*6+6).map(v => -v))})) }, benchmark);
  loadBalance.forEach((actual,k) => checks.push(check(`process.external-load-balance.${k}`, k<3 ? "kN" : "kN·m", actual, 0, true)));
}
