import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { bucklingColumn } = await server.ssrLoadModule("/src/validation/buckling-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { readResults } = await server.ssrLoadModule("/src/workspace/ai-results.ts");
  const { captureAiSnapshot } = await server.ssrLoadModule("/src/workspace/ai-tools.ts");
  const { proposeModelEdits, prepareModelEditConfirmation, ModelEditConfirmation } = await server.ssrLoadModule("/src/workspace/model-edits.ts");
  const { compareAnalysisResults } = await server.ssrLoadModule("/src/domain/analysis-comparison.ts");
  const cases = [], checks = [];
  const packet = (project, mutate) => {
    const request = structuredClone(createAnalysisRequest(a.captureAnalysisInput(project))); mutate?.(request);
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map((s) => JSON.parse(s));
    return { terminal: messages.at(-1), messages };
  };
  const solve = (name, project) => {
    const output = packet(project); assert.equal(output.terminal.kind, "result", JSON.stringify(output.terminal));
    const result = decodeAnalysisResult(output.terminal.result);
    assert.deepEqual(output.messages.filter((m) => m.kind === "phase").map((m) => m.record.stage), ["model-check", "assembly", "solve", "recovery"]);
    const saved = decodeProject(encodeProject(p.attachAnalysisResult(project, result)));
    assert.deepEqual(saved.latestAnalysis.buckling, JSON.parse(JSON.stringify(result.buckling))); assert.equal(a.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    assert.equal(saved.nodes.length, project.nodes.length); assert.equal(saved.members.length, project.members.length);
    assert.equal(captureAiSnapshot(saved, []).context.analysis.status, "complete");
    assert.equal(readResults(result, true, { collection: "summary" }).method, "buckling");
    assert.throws(() => readResults(result, true, { collection: "nodes" }), /屈曲/);
    const problem = result.buckling.eigenproblem;
    if (problem.stiffness) for (const [i, v] of problem.vectors.entries()) {
      const product = (matrix) => matrix.map((row) => row.reduce((sum, x, j) => sum + x * v[j], 0));
      const kv=product(problem.stiffness), fv=product(problem.fixedGeometric), rv=product(problem.referenceGeometric), lambda=result.buckling.modes[i].factor;
      const residual=Math.hypot(...kv.map((x,j)=>x+fv[j]+lambda*rv[j])) / Math.max(1e-30,(Math.hypot(...problem.stiffness.flat())+Math.hypot(...problem.fixedGeometric.flat())+lambda*Math.hypot(...problem.referenceGeometric.flat()))*Math.hypot(...v));
      assert.ok(residual<1e-8); checks.push({ name:`${name}:residual:${i}`, residual });
    }
    const { preloadRuns, eigenproblem, ...record } = result.buckling;
    cases.push({ name, ...record, matricesCaptured: eigenproblem.stiffness !== null, coordinates: eigenproblem.coordinates, vectors: eigenproblem.vectors, verifiedPreloadRuns: Object.fromEntries(Object.entries(preloadRuns).map(([role, run]) => [role, { solver: run.input.solver, sourceId: run.service.sourceId, dependencies: run.service.dependencies, calculationNodes: run.nodes.length, calculationMembers: run.members.length }])) }); return result;
  };
  const near = (name, actual, expected, relative=.002, absolute=1e-10) => {
    assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),`${name}: ${actual} vs ${expected}`); checks.push({ name, actual, expected, relative, absolute });
  };
  const correlation = (actual, expected) => Math.abs(actual.reduce((sum,v,i)=>sum+v*expected[i],0))/Math.sqrt(actual.reduce((sum,v)=>sum+v*v,0)*expected.reduce((sum,v)=>sum+v*v,0));
  const project=bucklingColumn(), result=solve("zero-fixed-cantilever",project);
  const e=200e6, iz=.000016666666666666667, iy=.00006666666666666667, length=3;
  const critical=(inertia, coefficient=4)=>Math.PI**2*e*inertia/(coefficient*length**2);
  const expected=[critical(iz),critical(iy),critical(iz)*9].sort((x,y)=>x-y).map((v)=>v/10);
  for(let i=0;i<3;i++) near(`cantilever-factor:${i}`,result.buckling.modes[i].factor,expected[i]);
  assert.equal(result.buckling.convergence.status,"converged");
  const analyticalShape=Array.from({length:17},(_,i)=>1-Math.cos(Math.PI*i/32));
  const shape=result.buckling.modes[0].members[0].samples.map((s)=>s.translation.y);
  near("cantilever-shape",correlation(shape,analyticalShape),1,1e-5);
  const errors=result.buckling.convergence.runs.map((r)=>Math.abs(r.factors[0]/expected[0]-1));
  assert.ok(errors.at(-1)<errors[0]/100); checks.push({name:"continuous-mesh-convergence",errors});
  const fixedProject=bucklingColumn(30), fixed=solve("nonzero-fixed",fixedProject), doubled=solve("double-reference",bucklingColumn(30,20));
  for(let i=0;i<3;i++) { near(`fixed-factor:${i}`,fixed.buckling.modes[i].factor,expected[i]-3); near(`reference-scaling:${i}`,doubled.buckling.modes[i].factor,fixed.buckling.modes[i].factor/2,1e-8); }
  assert.ok(fixed.buckling.prestress.every((v)=>Math.abs(v.fixedAxialStartKN+30)<1e-8 && Math.abs(v.referenceAxialStartKN+10)<1e-8));
  assert.equal(a.isAnalysisResultCurrent(p.updateNodalLoad(fixedProject,fixedProject.nodalLoads[1].id,fixedProject.nodes[1].id,{x:-31,y:0,z:0},{x:0,y:0,z:0}),fixed),false);
  assert.equal(a.isAnalysisResultCurrent(p.setNodeMass(fixedProject,fixedProject.nodes[1].id,1000),fixed),true);
  let pin=p.updateMember(project,project.members[0].id,{endReleases:{start:{my:true,mz:true},end:{my:true,mz:true}}});
  pin={...pin,supports:[{...project.supports[0],restraints:[true,true,true,true,false,false]},{id:"support_0002",label:"B2",nodeId:project.nodes[1].id,restraints:[false,true,true,true,false,false]}],nextSupportNumber:3};
  const pinned=solve("pinned-released",pin); near("pinned-factor",pinned.buckling.modes[0].factor,critical(iz,1)/10);
  assert.equal(pinned.buckling.counts.releaseCoordinates,4);
  near("pinned-shape",correlation(pinned.buckling.modes[0].members[0].samples.map((s)=>s.translation.y),analyticalShape.map((_,i)=>Math.sin(Math.PI*i/16))),1,1e-5);
  const rotated=p.updateMember(p.updateNode(project,project.nodes[1].id,{x:0,y:0,z:3}),project.members[0].id,{rotationDegrees:33});
  const rotatedResult=solve("rotated-column",p.updateNodalLoad(rotated,rotated.nodalLoads[0].id,rotated.nodes[1].id,{x:0,y:0,z:-10},{x:0,y:0,z:0}));
  for(let i=0;i<3;i++) near(`rotation:${i}`,rotatedResult.buckling.modes[i].factor,result.buckling.modes[i].factor,1e-8);
  // Portal frame: two columns, a pinned top tie. Symmetric in-plane sway leaves
  // the tie unstrained, so the exact continuum critical load is the cantilever value.
  let frame=p.createProject("Independent pinned-tie portal");
  for(const position of [{x:0,y:0,z:0},{x:0,y:0,z:3},{x:2,y:0,z:0},{x:2,y:0,z:3}]) frame=p.addNode(frame,position);
  frame=p.addMaterial(frame,{name:"E200",elasticModulusGPa:200,poissonRatio:.3,densityKgM3:7850});
  frame=p.addSection(frame,{name:"Column",areaM2:.02,secondMomentYM4:iy,secondMomentZM4:iz,torsionalConstantM4:.00004});
  for(const [start,end] of [[0,1],[2,3],[1,3]]) frame=p.addMember(frame,{startNodeId:frame.nodes[start].id,endNodeId:frame.nodes[end].id,materialId:frame.materials[0].id,sectionId:frame.sections[0].id,rotationDegrees:0,...(start===1?{endReleases:{start:{my:true,mz:true},end:{my:true,mz:true}}}:{})});
  for(const i of [0,2]) frame=p.addSupport(frame,frame.nodes[i].id,[true,true,true,true,true,true]);
  for(const i of [1,3]) frame=p.addSupport(frame,frame.nodes[i].id,[false,true,false,true,false,true]);
  for(const i of [1,3]) frame=p.addNodalLoad(frame,frame.nodes[i].id,{x:0,y:0,z:-10},{x:0,y:0,z:0});
  frame=p.addLoadCase(frame,"Fixed"); for(const i of [1,3]) frame=p.addNodalLoad(frame,frame.nodes[i].id,{x:0,y:0,z:-30},{x:0,y:0,z:0},"LC2");
  frame=p.selectAnalysisCase(p.addAnalysisCase(frame,{name:"Portal",method:"buckling",loadSourceId:"buckling",settings:{solver:"native-buckling",buckling:{...project.analysisCases[0].settings.buckling,modeCount:1,fixed:[{loadCaseId:"LC2",factor:1}]}}}),"AC1");
  const portal=solve("portal-nonzero-fixed",frame); near("portal-continuum-factor",portal.buckling.modes[0].factor,(critical(iz)-30)/10);
  const portalNodes=portal.buckling.modes[0].nodes; near("portal-symmetric-sway",portalNodes[1].translation.x/portalNodes[3].translation.x,1,1e-8);
  const settings=(changes)=>({name:project.analysisCases[0].name,method:"buckling",loadSourceId:"buckling",settings:{solver:"native-buckling",buckling:{...project.analysisCases[0].settings.buckling,...changes}}});
  const failure=(name,project,code,mutate)=>{const output=packet(project,mutate); assert.equal(output.terminal.kind,"error",JSON.stringify(output.terminal)); assert.ok(output.terminal.error.diagnostics.some((d)=>d.code===code),JSON.stringify(output.terminal)); checks.push({name,diagnostics:output.terminal.error.diagnostics});};
  failure("coarse-unconverged",p.updateAnalysisCase(project,"AC1",settings({maxDivisions:1})),"buckling-not-converged");
  failure("equation-budget",p.updateAnalysisCase(project,"AC1",settings({maxEquations:6})),"buckling-not-converged");
  failure("tension-reference",bucklingColumn(0,-10),"buckling-no-positive-factor");
  failure("unstable-fixed",bucklingColumn(1000),"buckling-unstable-preload");
  failure("initial-budget",p.updateAnalysisCase(project,"AC1",settings({maxEquations:1})),"buckling-budget-exhausted");
  failure("mechanism",{...project,supports:[]},"unrestrained-component");
  failure("tampered-source",project,"native-input-error",(r)=>r.input.bucklingLoads.reference.combination.definition.terms[0].factor=2);
  for(const mutate of [(r)=>r.buckling.prestress[0].referenceAxialStartKN+=1,(r)=>r.buckling.eigenproblem.stiffness[0][0]=1.7e308,(r)=>{r.buckling.modes[1]={...structuredClone(r.buckling.modes[0]),number:2};r.buckling.eigenproblem.vectors[1]=[...r.buckling.eigenproblem.vectors[0]];},(r)=>r.buckling.modes[0].factor*=2,(r)=>r.buckling.modes[0].members[0].samples[8].translation.y+=1,(r)=>r.input.bucklingLoads.reference.nodalLoads[0].force.x=-20]) {
    const changed=structuredClone(result); mutate(changed); assert.throws(()=>decodeAnalysisResult(changed));
  }
  const proposal=proposeModelEdits(project,{operations:[{type:"update_analysis_case",id:"AC1",properties:settings({reference:[{loadCaseId:"LC1",factor:2}]})}]});
  const approved=new ModelEditConfirmation().confirm(project,prepareModelEditConfirmation(project,proposal));
  near("tool-confirmed-reference",solve("tool-updated-reference",approved.project).buckling.modes[0].factor,result.buckling.modes[0].factor/2,1e-8);
  assert.equal(compareAnalysisResults(result,fixed).compatible,false);
  const zeroSource=p.updateAnalysisCase(fixedProject,"AC1",{name:"Zero dependency",method:"buckling",loadSourceId:"buckling",settings:{solver:"native-buckling",buckling:{...fixedProject.analysisCases[0].settings.buckling,fixed:[],reference:[{loadCaseId:"LC1",factor:1},{loadCaseId:"LC2",factor:0}]}}});
  const zeroResult=solve("zero-coefficient-source",zeroSource);
  assert.equal(a.isAnalysisResultCurrent(p.updateNodalLoad(zeroSource,zeroSource.nodalLoads[1].id,zeroSource.nodes[1].id,{x:-100,y:0,z:0},{x:0,y:0,z:0}),zeroResult),true);
  const square=p.updateSection(p.updateAnalysisCase(project,"AC1",settings({modeCount:2})),project.sections[0].id,{name:"Square",geometry:{shape:"rectangle",width:.1,height:.1}});
  const repeated=solve("repeated-first-pair",square);
  for(const mode of repeated.buckling.modes) near("repeated-factor",mode.factor,critical(.000008333333333333334)/10);
  const shapeVectors=repeated.buckling.modes.map((m)=>m.members[0].samples.flatMap((s)=>[s.translation.y,s.translation.z]));
  const basis=[];for(const v of shapeVectors){const w=[...v];for(const b of basis){const dot=b.reduce((sum,x,i)=>sum+x*w[i],0);w.forEach((x,i)=>w[i]=x-dot*b[i]);}const norm=Math.hypot(...w);basis.push(w.map((x)=>x/norm));}
  for(const plane of [0,1]){const v=analyticalShape.flatMap((x)=>plane===0?[x,0]:[0,x]),norm=Math.hypot(...v);const projection=basis.reduce((sum,b)=>sum+(b.reduce((dot,x,i)=>dot+x*v[i],0)/norm)**2,0);near(`repeated-subspace:${plane}`,projection,1,1e-5);}
  const savedDeleted=decodeProject(encodeProject(p.deleteLoadCase(p.attachAnalysisResult(fixedProject,fixed),"LC2",true)));
  assert.equal(savedDeleted.analysisCases.length,0);assert.deepEqual(savedDeleted.latestAnalysis.buckling,JSON.parse(JSON.stringify(fixed.buckling)));assert.equal(a.isAnalysisResultCurrent(savedDeleted,savedDeleted.latestAnalysis),false);
  const axialWeight=p.updateSelfWeight(fixedProject,{enabled:true,loadCaseId:"LC2",gravity:{x:-9.81,y:0,z:0}});
  const weightResult=solve("fixed-axial-self-weight",axialWeight);
  near("self-weight-root-prestress",weightResult.buckling.prestress[0].fixedAxialStartKN,-34.62051,1e-9);
  near("self-weight-tip-prestress",weightResult.buckling.prestress.at(-1).fixedAxialEndKN,-30,1e-9);
  assert.ok(weightResult.buckling.modes[0].factor<fixed.buckling.modes[0].factor);
  assert.equal(a.isAnalysisResultCurrent(p.updateMaterial(axialWeight,axialWeight.materials[0].id,{...axialWeight.materials[0],densityKgM3:8000}),weightResult),false);
  const distributed=p.addUniformLoad(fixedProject,{kind:"uniform",memberId:fixedProject.members[0].id,coordinateSystem:"local",loadCaseId:"LC2",intensity:{x:-2,y:0,z:0}});
  const uniformResult=solve("fixed-distributed-axial",distributed);near("uniform-root-prestress",uniformResult.buckling.prestress[0].fixedAxialStartKN,-36,1e-9);near("uniform-tip-prestress",uniformResult.buckling.prestress.at(-1).fixedAxialEndKN,-30,1e-9);
  const evidence=resolve("docs/evidence/plan2/T2-30"); await mkdir(evidence,{recursive:true});
  await writeFile(resolve(evidence,"nonzero-fixed.framemind"),encodeProject(p.attachAnalysisResult(fixedProject,fixed)));
  await writeFile(resolve(evidence,"numerics.json"),JSON.stringify({passed:true,registeredToleranceADR:"0063",cases,checks},null,2));
  console.log(JSON.stringify({passed:true,nativeRuns:cases.length,checks:checks.length,evidence}));
} finally { await server.close(); }
