import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { modalCantilever } = await server.ssrLoadModule("/src/validation/modal-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, encodeProject, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { readResults } = await server.ssrLoadModule("/src/workspace/ai-results.ts");
  const cases = [], checks = [];
  const packet = (project, mutate) => {
    const request = structuredClone(createAnalysisRequest(a.captureAnalysisInput(project))); mutate?.(request);
    const start = performance.now();
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map((s) => JSON.parse(s));
    return { terminal: messages.at(-1), messages, elapsedMs: performance.now() - start };
  };
  const solve = (name, project) => {
    const output = packet(project); assert.equal(output.terminal.kind, "result", JSON.stringify(output.terminal));
    const result = decodeAnalysisResult(output.terminal.result);
    assert.deepEqual(output.messages.filter((m) => m.kind === "phase").map((m) => m.record.stage), ["model-check", "assembly", "solve", "recovery"]);
    const saved = decodeProject(encodeProject(p.attachAnalysisResult(project, result)));
    assert.deepEqual(saved.latestAnalysis.modal, JSON.parse(JSON.stringify(result.modal))); assert.equal(a.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    assert.equal(saved.nodes.length, project.nodes.length); assert.equal(saved.members.length, project.members.length);
    const problem = result.modal.eigenproblem;
    if (problem.stiffness && problem.mass) {
      const dot = (x,y) => x.reduce((sum,v,i) => sum+v*y[i],0);
      const product = (matrix,v) => matrix.map((row) => dot(row,v));
      const kNorm = Math.hypot(...problem.stiffness.flat());
      const massVectors = problem.vectors.map((v) => product(problem.mass,v));
      for (const [i,v] of problem.vectors.entries()) {
        const lambda = result.modal.modes[i].eigenvalue, kv = product(problem.stiffness,v), mv = massVectors[i];
        const residual = Math.hypot(...kv.map((x,j) => x-lambda*mv[j])) / Math.max(1e-30,kNorm*Math.hypot(...v)+Math.abs(lambda)*Math.hypot(...mv));
        assert.ok(residual<1e-8); checks.push({ name:`${name}:independent-residual:${i}`,residual });
        for (let j=0;j<=i;j++) {
          const value=dot(v,massVectors[j]), expected=i===j?1:0; assert.ok(Math.abs(value-expected)<1e-8);
          checks.push({name:`${name}:mass-orthogonality:${i}:${j}`,actual:value,expected});
        }
      }
    }
    cases.push({ name, elapsedMs: output.elapsedMs, ...result.modal }); return result;
  };
  const near = (name, actual, expected, relative = 1e-4, absolute = 1e-10) => {
    assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${name}: ${actual} vs ${expected}`);
    checks.push({ name, actual, expected, relative, absolute });
  };
  const project = modalCantilever(), result = solve("cantilever", project);
  const beam = project.sections[0], material = project.materials[0], length = 3, rho = material.densityKgM3, e = material.elasticModulusGPa * 1e9;
  const beta = [1.875104068711961, 4.694091132974175, 7.854757438237612];
  const bending = (inertia, b) => b*b/(2*Math.PI*length*length)*Math.sqrt(e*inertia/(rho*beam.areaM2));
  const expected = [...beta.flatMap((b) => [bending(beam.secondMomentYM4,b), bending(beam.secondMomentZM4,b)]),
    ...[1,3,5].map((n) => n/(4*length)*Math.sqrt(e/(2*(1+material.poissonRatio))*beam.torsionalConstantM4/(rho*(beam.secondMomentYM4+beam.secondMomentZM4)))),
    ...[1,3].map((n) => n/(4*length)*Math.sqrt(e/rho))].sort((x,y) => x-y);
  for (let i=0;i<6;i++) near(`cantilever:frequency:${i+1}`,result.modal.modes[i].frequencyHz,expected[i], 5e-4);
  near("total-mass", result.modal.totalMassKg, 471, 1e-12);
  assert.equal(result.modal.convergence.status, "converged");
  // Independent continuum mode shape, comparison permits arbitrary sign/scale.
  const b=beta[0], ratio=(Math.cosh(b)+Math.cos(b))/(Math.sinh(b)+Math.sin(b));
  const shape=Array.from({length:17},(_,i) => Math.cosh(b*i/16)-Math.cos(b*i/16)-ratio*(Math.sinh(b*i/16)-Math.sin(b*i/16)));
  const first=result.modal.modes[0].members[0].samples.map((s) => s.translation.y);
  const cosine=Math.abs(first.reduce((sum,v,i) => sum+v*shape[i],0))/Math.sqrt(first.reduce((sum,v) => sum+v*v,0)*shape.reduce((sum,v) => sum+v*v,0));
  near("continuum-shape-correlation",cosine,1,1e-6);
  // Convergence is independently checked against the analytical first frequency.
  const errors=result.modal.convergence.runs.map((run) => Math.abs(run.frequenciesHz[0]/expected[0]-1));
  assert.ok(errors.at(-1) < errors[0]/100); checks.push({ name:"continuum-mesh-convergence", errors });
  let selfWeight = p.updateSelfWeight(project, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
  const weighted=solve("self-weight-on",selfWeight); assert.deepEqual(weighted.modal,result.modal);
  selfWeight = p.updateSelfWeight(selfWeight, { ...selfWeight.selfWeight, enabled: false });
  assert.deepEqual(solve("self-weight-off",selfWeight).modal,result.modal);
  const doubled=p.updateMaterial(project,material.id,{...material,densityKgM3:rho*2});
  const doubledResult=solve("double-density",doubled);
  for (let i=0;i<6;i++) near(`density:${i}`,doubledResult.modal.modes[i].frequencyHz,result.modal.modes[i].frequencyHz/Math.sqrt(2),1e-8);
  assert.equal(a.isAnalysisResultCurrent(doubled,result),false); assert.equal(a.isAnalysisResultCurrent(selfWeight,result),true);
  const modalProperties=(settings) => ({ name:"Modal",method:"modal",loadSourceId:"structure",settings:{solver:"native-modal",modal:{...project.analysisCases[0].settings.modal,...settings}} });
  const coarse=solve("coarse-unconverged",p.updateAnalysisCase(project,"AC1",modalProperties({maxDivisions:1}))); assert.equal(coarse.modal.convergence.status,"budget-exhausted");
  const budget=solve("equation-budget",p.updateAnalysisCase(project,"AC1",modalProperties({maxEquations:7}))); assert.equal(budget.modal.convergence.reason,"equation-budget");
  const free=solve("free-free",{...project,supports:[]}); assert.equal(free.modal.zeroEnergyModes,6); assert.equal(free.modal.modes.every((m) => m.kind==="zero-energy"),true);
  let pin=p.updateMember(project,project.members[0].id,{endReleases:{start:{my:true,mz:true},end:{my:true,mz:true}}});
  pin={...pin,supports:[{...project.supports[0],restraints:[true,true,true,true,false,false]},{id:"support_0002",label:"B2",nodeId:project.nodes[1].id,restraints:[false,true,true,true,false,false]}],nextSupportNumber:3};
  const pinned=solve("pinned-released",pin); assert.equal(pinned.modal.counts.releaseCoordinates,4);
  near("pinned-frequency",pinned.modal.modes[0].frequencyHz,bending(beam.secondMomentZM4,Math.PI),5e-4);
  const pinShape=pinned.modal.modes[0].members[0].samples.map((s) => s.translation.y), sine=pinShape.map((_,i) => Math.sin(Math.PI*i/16));
  const pinCos=Math.abs(pinShape.reduce((sum,v,i)=>sum+v*sine[i],0))/Math.sqrt(pinShape.reduce((sum,v)=>sum+v*v,0)*sine.reduce((sum,v)=>sum+v*v,0)); near("pinned-shape",pinCos,1,1e-6);
  const fixed = solve("fixed-fixed", p.addSupport(project,project.nodes[1].id,[true,true,true,true,true,true]));
  const fixedExpected = [...[4.730040744862704,7.853204624095838,10.99560783800167].flatMap((b) => [bending(beam.secondMomentYM4,b),bending(beam.secondMomentZM4,b)]),
    ...[1,2,3].map((n) => n/(2*length)*Math.sqrt(e/(2*(1+material.poissonRatio))*beam.torsionalConstantM4/(rho*(beam.secondMomentYM4+beam.secondMomentZM4)))),
    ...[1,2].map((n) => n/(2*length)*Math.sqrt(e/rho))].sort((x,y) => x-y);
  for(let i=0;i<6;i++) near(`fixed-frequency:${i}`,fixed.modal.modes[i].frequencyHz,fixedExpected[i],0.002);
  assert.equal(fixed.modal.convergence.runs[0].divisions,2);
  const rotated = p.updateMember(p.updateNode(project,project.nodes[1].id,{x:0,y:0,z:3}),project.members[0].id,{rotationDegrees:33});
  const rotatedResult = solve("vertical-rotated-axes",rotated);
  for(let i=0;i<6;i++) near(`rotation-invariance:${i}`,rotatedResult.modal.modes[i].frequencyHz,result.modal.modes[i].frequencyHz,1e-8);
  // Simple symmetric two-arm frame: four repeated transverse first modes.
  let frame = p.updateSection(project,beam.id,{name:"Square",geometry:{shape:"rectangle",width:.1,height:.1}});
  frame=p.addNode(frame,{x:-3,y:0,z:0}); frame=p.addMember(frame,{materialId:material.id,sectionId:beam.id,rotationDegrees:0,startNodeId:frame.nodes[0].id,endNodeId:frame.nodes[2].id});
  const framed=solve("symmetric-frame-repeated-root",frame), square=frame.sections[0];
  for(let i=0;i<4;i++) near(`frame-repeated:${i}`,framed.modal.modes[i].frequencyHz,beta[0]**2/(2*Math.PI*9)*Math.sqrt(e*square.secondMomentYM4/(rho*square.areaM2)),5e-4);
  // Projector for the four-dimensional repeated eigenspace at both free tips.
  const columns=framed.modal.modes.slice(0,4).map((m) => [m.nodes[1].translation.y,m.nodes[1].translation.z,m.nodes[2].translation.y,m.nodes[2].translation.z]);
  const orthogonal=[]; for(const c of columns) { const v=[...c]; for(const q of orthogonal) { const dot=v.reduce((sum,x,i)=>sum+x*q[i],0); for(let i=0;i<4;i++)v[i]-=dot*q[i]; } const norm=Math.hypot(...v); assert.ok(norm>1e-8); orthogonal.push(v.map((x)=>x/norm)); }
  for(let i=0;i<4;i++)for(let j=0;j<4;j++) near(`frame-subspace:${i}:${j}`,orthogonal.reduce((sum,q)=>sum+q[i]*q[j],0),i===j?1:0,1e-8);
  const badDensity=packet(project,(r)=>{r.input.materials[0].densityKgM3=0;}); assert.equal(badDensity.terminal.kind,"error"); assert.equal(badDensity.terminal.error.diagnostics[0].target.kind,"material");
  const missing=packet(project,(r)=>{delete r.input.materials[0].densityKgM3;}); assert.equal(missing.terminal.kind,"error");
  const badMass=packet(project,(r)=>{r.input.nodalLoads.push({});}); assert.equal(badMass.terminal.kind,"error");
  const initialBudget=packet(p.updateAnalysisCase(project,"AC1",modalProperties({maxEquations:1}))); assert.equal(initialBudget.terminal.kind,"error");
  const singularMass=packet(project,(r)=>{r.input.materials[0].densityKgM3=1e-320;}); assert.equal(singularMass.terminal.kind,"error"); assert.equal(singularMass.terminal.error.diagnostics[0].code,"modal-singular-mass");
  const forged=structuredClone(result); forged.modal.totalMassKg+=1; assert.throws(()=>decodeAnalysisResult(forged));
  const summary=readResults(result,true,{collection:"summary"}), modes=readResults(result,true,{collection:"modes",offset:1,limit:2}), mass=readResults(result,true,{collection:"mass"});
  assert.equal(summary.method,"modal"); assert.equal(modes.items.length,2); near("tool-mass",mass.items[0].massKg,471,1e-12);
  assert.throws(()=>readResults(result,true,{collection:"nodes"}));
  await mkdir("docs/evidence/plan2/T2-27",{recursive:true});
  await writeFile("docs/evidence/plan2/T2-27/numerics.json",JSON.stringify({passed:true,cases,checks,diagnosticCases:5},null,2));
  await writeFile("docs/evidence/plan2/T2-27/cantilever.framemind",encodeProject(p.attachAnalysisResult(project,result)));
  console.log(JSON.stringify({passed:true,cases:cases.length,checks:checks.length,diagnosticCases:5}));
} finally { await server.close(); }
