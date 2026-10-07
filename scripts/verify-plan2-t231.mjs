import { numericalEvidenceDirectory } from "./numerical-evidence.mjs";
import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { secondOrderColumn } = await server.ssrLoadModule("/src/validation/second-order-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts"), a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { readResults, readResult } = await server.ssrLoadModule("/src/workspace/ai-results.ts");
  const { captureAiSnapshot } = await server.ssrLoadModule("/src/workspace/ai-tools.ts");
  const { proposeModelEdits, prepareModelEditConfirmation, ModelEditConfirmation } = await server.ssrLoadModule("/src/workspace/model-edits.ts");
  const { compareAnalysisResults } = await server.ssrLoadModule("/src/domain/analysis-comparison.ts");
  const { readComparison } = await server.ssrLoadModule("/src/workspace/ai-comparison.ts");
  const { secondOrderSystem } = await server.ssrLoadModule("/src/domain/second-order-process.ts");
  const { mapMeshEngineeringResult, meshError } = await server.ssrLoadModule("/src/domain/mesh-result.ts");
  const cases = [], checks = [], failures = [];
  const packet = (project, mutate) => {
    const input = a.captureAnalysisInput(project);
    const request = structuredClone(createAnalysisRequest(input.analysisCase?.method === "static" ? { ...input, solver: { ...a.NATIVE_MESH_STATIC_SOLVER } } : input)); mutate?.(request);
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map((s) => JSON.parse(s));
    return messages.at(-1);
  };
  const solve = (name, project) => {
    const output = packet(project); assert.equal(output.kind, "result", JSON.stringify({ name, diagnostics: output.error?.diagnostics?.map(({ convergence, iterations, ...diagnostic }) => ({ ...diagnostic, convergence: convergence?.map(({ divisions, error }) => ({ divisions, error })), iterations: iterations?.length })) }));
    const result = decodeAnalysisResult(output.result);
    const saved = decodeProject(encodeProject(p.attachAnalysisResult(project, result)));
    assert.deepEqual(JSON.parse(JSON.stringify(saved.latestAnalysis.secondOrder)), JSON.parse(JSON.stringify(result.secondOrder)));
    assert.equal(a.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    assert.equal(readResults(result, true, { collection: "summary" }).method, "second-order");
    assert.equal(readResults(result, true, { collection: "mesh" }).total, result.input.members.length * result.secondOrder.selectedDivisions);
    assert.equal(captureAiSnapshot(saved, []).context.analysis.status, "complete");
    assert.throws(() => a.getOverallAnalysisProcessRecord(result), /二阶/);
    assert.throws(() => a.getMemberAnalysisRecord(result, result.members[0].memberId), /二阶/);
    cases.push({ name, displacement: result.nodes[1].displacement, endForces: result.members[0].localEndForces, runs: result.secondOrder.runs.map((r) => ({ divisions: r.divisions, error: r.error, equations: r.calculation.vector.length, iterations: r.calculation.iterations.map(({ displacement, correction, ...record }) => record) })) });
    return result;
  };
  const near = (name, actual, expected, relative = .005, absolute = 1e-9) => { assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${name}: ${actual} vs ${expected}`); checks.push({ name, actual, expected, relative, absolute }); };
  const ei = 200e6 * (.2 * .1 ** 3 / 12), length = 3, h = .1;
  const tip = (compression, lateral = h) => {
    if (compression === 0) return lateral * length ** 3 / (3 * ei);
    const k = Math.sqrt(Math.abs(compression) / ei), kl = k * length;
    return compression > 0 ? lateral / (compression * k) * (Math.tan(kl) - kl) : lateral / (-compression * k) * (kl - Math.tanh(kl));
  };
  for (const compression of [0, 200, 500, -500]) {
    const result = solve(`cantilever-${compression}`, secondOrderColumn(compression));
    near(`tip-${compression}`, result.nodes[1].displacement.y, tip(compression));
    near(`moment-${compression}`, -result.members[0].localEndForces.start[5], h * length + compression * tip(compression));
    near(`horizontal-equilibrium-${compression}`, result.nodes[0].reaction.y, -h, 1e-8);
    const iterations = result.secondOrder.runs.flatMap((r) => r.calculation.iterations);
    assert.ok(iterations.every((r) => r.residual < 1e-8));
    const last = result.secondOrder.runs.at(-1), first = result.secondOrder.runs[0];
    const initialError = Math.abs(first.calculation.nodes[1].displacement.y / tip(compression) - 1), finalError = Math.abs(result.nodes[1].displacement.y / tip(compression) - 1);
    assert.ok(compression === 0 || finalError < initialError); checks.push({ name: `mesh-continuum-${compression}`, initialError, finalError, divisions: last.divisions });
  }
  const base = secondOrderColumn(), original = solve("baseline", base), oneStep = solve("one-load-step", secondOrderColumn(500, .1, { loadSteps: 1 }));
  near("load-step-independence", oneStep.nodes[1].displacement.y, original.nodes[1].displacement.y, 1e-8);
  const doubled = solve("double-full-load", secondOrderColumn(1000 / 2, .2));
  near("lateral-linearity-at-fixed-prestress", doubled.nodes[1].displacement.y, original.nodes[1].displacement.y * 2, 1e-8);
  const scaled = solve("half-full-load", secondOrderColumn(250, .05));
  assert.ok(Math.abs(scaled.nodes[1].displacement.y * 2 / original.nodes[1].displacement.y - 1) > .1);
  checks.push({ name: "full-load-response-not-superposable", ratio: scaled.nodes[1].displacement.y * 2 / original.nodes[1].displacement.y });
  const rotation = .61, direction = { x: Math.cos(rotation), y: Math.sin(rotation), z: 0 }, transverse = { x: -Math.sin(rotation), y: Math.cos(rotation), z: 0 };
  let rotated = p.updateNode(base, base.nodes[1].id, { x: 3 * direction.x, y: 3 * direction.y, z: 0 });
  rotated = p.updateNodalLoad(rotated, rotated.nodalLoads[0].id, rotated.nodes[1].id, { x: -500 * direction.x + .1 * transverse.x, y: -500 * direction.y + .1 * transverse.y, z: 0 }, { x: 0, y: 0, z: 0 });
  const rotatedResult = solve("rotated-column", rotated);
  near("rotated-tip", rotatedResult.nodes[1].displacement.x * transverse.x + rotatedResult.nodes[1].displacement.y * transverse.y, original.nodes[1].displacement.y, 1e-7);
  // Independent continuous shooting integration of v'=theta, theta'=M/EI,
  // M'=V+N(x)*theta, V'=q. RK4 is unrelated to the Hermite FE implementation.
  const continuous = (compression, axialIntensity, transverseIntensity, lateral) => {
    const integrate = (moment, forcing) => {
      let y = [0, 0, moment]; const dx = length / 4096;
      const f = (x, v) => [v[1], v[2] / ei, (forcing ? -lateral - transverseIntensity * (length - x) : 0) + (-compression - axialIntensity * (length - x)) * v[1]];
      for (let i = 0; i < 4096; i++) { const x = i * dx, k1 = f(x, y), k2 = f(x + dx / 2, y.map((v,j)=>v+dx*k1[j]/2)), k3 = f(x + dx / 2, y.map((v,j)=>v+dx*k2[j]/2)), k4 = f(x+dx,y.map((v,j)=>v+dx*k3[j])); y=y.map((v,j)=>v+dx*(k1[j]+2*k2[j]+2*k3[j]+k4[j])/6); }
      return y;
    };
    const particular = integrate(0, true), homogeneous = integrate(1, false), rootMoment = -particular[2] / homogeneous[2];
    return { tip: particular[0] + rootMoment * homogeneous[0], rootMoment };
  };
  let distributed = secondOrderColumn(200);
  distributed = p.addUniformLoad(distributed, { memberId: distributed.members[0].id, loadCaseId: "LC1", kind: "uniform", coordinateSystem: "local", intensity: { x: -20, y: .02, z: 0 } });
  const qResult = solve("distributed-axial-and-transverse", distributed), reference = continuous(200, 20, .02, .1);
  near("variable-axial-tip", qResult.nodes[1].displacement.y, reference.tip);
  near("variable-axial-moment", -qResult.members[0].localEndForces.start[5], reference.rootMoment);
  // Two identical vertical cantilevers with a pinned tie: symmetric sway leaves
  // the tie unstrained. Each column has the exact independent cantilever solution.
  let frame = p.createProject("Independent elastic second-order portal");
  for (const position of [{x:0,y:0,z:0},{x:0,y:0,z:3},{x:2,y:0,z:0},{x:2,y:0,z:3}]) frame=p.addNode(frame,position);
  frame=p.addMaterial(frame,base.materials[0]); frame=p.addSection(frame,base.sections[0]);
  for (const [start,end] of [[0,1],[2,3],[1,3]]) frame=p.addMember(frame,{startNodeId:frame.nodes[start].id,endNodeId:frame.nodes[end].id,materialId:frame.materials[0].id,sectionId:frame.sections[0].id,rotationDegrees:0,...(start===1?{endReleases:{start:{my:true,mz:true},end:{my:true,mz:true}}}:{})});
  for(const i of [0,2]) frame=p.addSupport(frame,frame.nodes[i].id,[true,true,true,true,true,true]);
  for(const i of [1,3]) { frame=p.addSupport(frame,frame.nodes[i].id,[false,true,false,true,false,true]); frame=p.addNodalLoad(frame,frame.nodes[i].id,{x:.1,y:0,z:-200},{x:0,y:0,z:0}); }
  frame=p.selectAnalysisCase(p.addAnalysisCase(frame,{name:"Portal",method:"second-order",loadSourceId:"LC1",settings:base.analysisCases[0].settings}),"AC1");
  const frameResult=solve("pinned-tie-portal",frame);
  for(const i of [1,3]) near(`portal-tip-${i}`,frameResult.nodes[i].displacement.x,tip(200));
  near("portal-horizontal-equilibrium",frameResult.nodes[0].reaction.x+frameResult.nodes[2].reaction.x,-.2,1e-8);
  assert.ok(frameResult.secondOrder.runs.at(-1).calculation.coordinates.filter((c)=>c.kind==="release").length===4);
  let combined = p.addLoadCase(base,"Additional lateral"); combined=p.addNodalLoad(combined,combined.nodes[1].id,{x:0,y:.1,z:0},{x:0,y:0,z:0},"LC2");
  combined=p.addLoadCombination(combined,"Input combination",[{loadCaseId:"LC1",factor:1},{loadCaseId:"LC2",factor:1}]);
  combined=p.updateAnalysisCase(combined,"AC1",{...combined.analysisCases[0],loadSourceId:"CB1"});
  const combo=solve("input-combination",combined); near("combination-solved-effective-input",combo.nodes[1].displacement.y,doubled.nodes[1].displacement.y,1e-8);
  assert.equal(a.isAnalysisResultCurrent(p.updateNodalLoad(base,base.nodalLoads[0].id,base.nodes[1].id,{x:-499,y:.1,z:0},{x:0,y:0,z:0}),original),false);
  assert.equal(a.isAnalysisResultCurrent(p.setNodeMass(base,base.nodes[1].id,1000),original),true);
  const read = readResult(original,true,{kind:"member",id:base.members[0].id,quantity:"sectionForces",component:"Mz",position:1.25},"check"); assert.ok(Number.isFinite(read.value));
  const different=p.selectAnalysisCase(p.addAnalysisCase(base,{name:"Linear",method:"static",loadSourceId:"LC1",settings:{solver:"native-static"}}),"AC2");
  assert.equal(compareAnalysisResults(a.solveFrame({...a.captureAnalysisInput(different),solver:{...a.ANALYSIS_SOLVER}}),original).compatible,false);
  const zeroProject = secondOrderColumn(0), zeroResult = solve("same-input-comparison-zero-prestress", zeroProject);
  const linearProject = p.selectAnalysisCase(p.addAnalysisCase(zeroProject, { name: "Corresponding linear", method: "static", loadSourceId: "LC1", settings: { solver: "native-static" } }), "AC2");
  const linearPacket = packet(linearProject); assert.equal(linearPacket.kind, "result"); const linearResult = decodeAnalysisResult(linearPacket.result);
  assert.equal(compareAnalysisResults(linearResult,zeroResult).compatible,true);
  assert.match(readComparison({before:linearResult,after:zeroResult,beforeCurrent:true,afterCurrent:true},{collection:"summary"}).attribution,/方法差异/);
  near("same-input-zero-prestress-comparison",linearResult.nodes[1].displacement.y,zeroResult.nodes[1].displacement.y,1e-8);
  const changedLoad = structuredClone(linearResult); changedLoad.input.nodalLoads[0].force.y *= 2;
  assert.equal(compareAnalysisResults(changedLoad,zeroResult).compatible,false);
  let weightProject = p.updateNode(secondOrderColumn(200),base.nodes[1].id,{x:0,y:0,z:3});
  weightProject = p.updateNodalLoad(weightProject,weightProject.nodalLoads[0].id,weightProject.nodes[1].id,{x:.1,y:0,z:-200},{x:0,y:0,z:0});
  weightProject = p.updateSelfWeight(weightProject,{enabled:true,loadCaseId:"LC1",gravity:{x:0,y:0,z:-9.81}});
  const weightResult = solve("actual-self-weight",weightProject), weightReference = continuous(200,7850*.02*9.81/1000,0,.1);
  near("self-weight-tip",weightResult.nodes[1].displacement.x,weightReference.tip);
  const { id: _caseId, ...properties } = base.analysisCases[0];
  const draft=proposeModelEdits(base,{operations:[{type:"update_analysis_case",id:"AC1",properties:{...properties,name:"Tool-controlled",settings:{...properties.settings,secondOrder:{...properties.settings.secondOrder,loadSteps:2}}}}]});
  const applied=new ModelEditConfirmation().confirm(base,prepareModelEditConfirmation(base,draft)); assert.equal(applied.result.status,"applied"); solve("confirmed-tool-controls",applied.project);
  const forgeOvercriticalAxial = (result) => {
    const r = structuredClone(result), scaleV = (v) => v.map((x) => x * 5), scale3 = (v) => Object.fromEntries(Object.entries(v).map(([k,x]) => [k,x*5]));
    const scaleResponses = (value) => {
      for (const n of value.nodes) for (const k of ["displacement","rotation","reaction","reactionMoment"]) n[k]=scale3(n[k]);
      for (const m of value.members) { m.localEndForces.start=scaleV(m.localEndForces.start); m.localEndForces.end=scaleV(m.localEndForces.end);
        for (const s of m.nativeResponses) { s.forces=scaleV(s.forces); s.localDisplacement=scale3(s.localDisplacement); s.globalDisplacement=scale3(s.globalDisplacement); }
      }
    };
    for (const n of r.input.nodalLoads) n.force=scale3(n.force); scaleResponses(r);
    let previous;
    for (const [i,run] of r.secondOrder.runs.entries()) {
      const c=run.calculation; for (const n of c.linearRun.input.nodalLoads) n.force=scale3(n.force);
      c.linearRun.process.loadVector=scaleV(c.linearRun.process.loadVector); scaleResponses(c.linearRun);
      c.vector=scaleV(c.vector); c.force=scaleV(c.force); c.geometric=c.geometric?.map(scaleV)??null; c.localDisplacements=c.localDisplacements.map(scaleV); scaleResponses(c);
      const system=secondOrderSystem(c), norm=(v,force=false)=>Math.hypot(...v.map((x,i)=>force?x/Math.sqrt(system.diagonal[i]):x*Math.sqrt(system.diagonal[i])));
      const residual=(v,a)=>{const rhs=system.force.map((x)=>a*x), product=system.multiply(v,a);return norm(rhs.map((x,i)=>x-product[i]),true)/Math.max(1,norm(rhs,true));};
      let before=c.vector.map(()=>0);
      for (const it of c.iterations) {it.displacement=scaleV(it.displacement);it.correction=scaleV(it.correction);it.residualBefore=residual(before,it.factor);it.residual=residual(it.displacement,it.factor);it.increment=norm(it.correction)/Math.max(1e-12,norm(it.displacement));before=it.displacement;}
      const mapped=mapMeshEngineeringResult(r.input,{...c.linearRun,nodes:c.nodes,members:c.members},r.input.meshPlan.levels[i]); if(previous)run.error=meshError(previous,mapped,r.input.meshPlan.policy);previous=mapped;
    }
    return r;
  };
  const axial = solve("pure-axial-stable",secondOrderColumn(200,0));
  assert.throws(()=>decodeAnalysisResult(forgeOvercriticalAxial(axial)),/非正定/); failures.push({name:"unexcited-overcritical-saved-column",rejected:true});
  let large = p.createProject("25 independent axial columns"); large=p.addMaterial(large,base.materials[0]);large=p.addSection(large,base.sections[0]);
  for(let i=0;i<25;i++) {
    large=p.addNode(large,{x:0,y:i,z:0});large=p.addNode(large,{x:3,y:i,z:0});const start=large.nodes.at(-2).id,end=large.nodes.at(-1).id;
    large=p.addMember(large,{startNodeId:start,endNodeId:end,materialId:large.materials[0].id,sectionId:large.sections[0].id,rotationDegrees:0});
    large=p.addSupport(large,start,[true,true,true,true,true,true]);large=p.addNodalLoad(large,end,{x:-200,y:0,z:0},{x:0,y:0,z:0});
  }
  large=p.selectAnalysisCase(p.addAnalysisCase(large,{...properties,name:"Large axial matrix boundary"}),"AC1");
  const largeResult=solve("over-matrix-limit-stable",large);assert.ok(largeResult.secondOrder.runs.every((r)=>r.calculation.vector.length>144&&r.calculation.geometric===null));
  assert.throws(()=>decodeAnalysisResult(forgeOvercriticalAxial(largeResult)),/非正定/); failures.push({name:"over-matrix-limit-overcritical-saved-columns",rejected:true});
  for (const [name, project, expected] of [
    ["iteration-limit",secondOrderColumn(500,.1,{maxIterations:1}),"second-order-not-converged"],
    ["over-critical",secondOrderColumn(1000),"second-order-unstable-tangent"],
    ["scope-limit",secondOrderColumn(500,100),"second-order-scope-exceeded"],
    ["mesh-limit",secondOrderColumn(500,.1,{maxDivisions:1}),"second-order-mesh-not-converged"],
    ["equation-limit",secondOrderColumn(500,.1,{maxEquations:1}),"second-order-budget-exhausted"],
  ]) { const output=packet(project); assert.equal(output.kind,"error"); assert.equal(output.error.diagnostics[0].code,expected); failures.push({name,code:expected}); }
  for (const [name, mutate] of [
    ["fabricated-zero-correction",(r)=>{const c=r.secondOrder.runs[0].calculation, first=c.iterations[0]; c.iterations.filter((v)=>v.step===1).forEach((v)=>v.iteration++); c.iterations.unshift({...first,iteration:1,displacement:first.displacement.map(()=>0),correction:first.correction.map(()=>0),residual:first.residualBefore,increment:0});}],
    ["forged-iteration",(r)=>{r.secondOrder.runs.at(-1).calculation.iterations.at(-1).residual=0.5;}],
    ["forged-linear-load",(r)=>{r.secondOrder.runs.at(-1).calculation.linearRun.input.nodalLoads[0].force.x+=1;}],
    ["forged-geometric",(r)=>{r.secondOrder.runs[0].calculation.geometric[0][0]+=1;}],
    ["forged-response",(r)=>{r.nodes[1].displacement.y+=.001;}],
    ["forged-mesh-error",(r)=>{r.secondOrder.runs.at(-1).error.sectionForce=0;}],
  ]) { const changed=structuredClone(original); mutate(changed); assert.throws(()=>decodeAnalysisResult(changed)); failures.push({name,rejected:true}); }
  const directory = numericalEvidenceDirectory("T2-31"); await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/baseline.framemind`, encodeProject(p.attachAnalysisResult(base, original)));
  await writeFile(`${directory}/numerics.json`, JSON.stringify({ cases, checks, failures, passed: true }, null, 2));
  console.log(JSON.stringify({ cases: cases.length, checks: checks.length, failures: failures.length, passed: true }));
} finally { await server.close(); }
