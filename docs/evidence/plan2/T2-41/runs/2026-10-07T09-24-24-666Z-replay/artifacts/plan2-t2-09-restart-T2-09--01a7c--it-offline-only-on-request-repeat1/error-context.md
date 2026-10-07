# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-09-restart.spec.ts >> T2-09 freezes an interrupted local calculation and resumes it offline only on request
- Location: e2e\plan2-t2-09-restart.spec.ts:150:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   2
+ Received  + 452

@@ -50,10 +50,460 @@
        "rotationDegrees": 0,
        "sectionId": "section_0001",
        "startNodeId": "node_0003",
      },
    ],
+   "meshPlan": Object {
+     "frames": Object {
+       "member_0001": Object {
+         "length": 4,
+         "localX": Object {
+           "x": 0,
+           "y": 0,
+           "z": 1,
+         },
+         "localY": Object {
+           "x": 1,
+           "y": 0,
+           "z": 0,
+         },
+         "localZ": Object {
+           "x": 0,
+           "y": 1,
+           "z": 0,
+         },
+         "referenceAxis": "global-y",
+       },
+       "member_0002": Object {
+         "length": 4,
+         "localX": Object {
+           "x": 0,
+           "y": 0,
+           "z": 1,
+         },
+         "localY": Object {
+           "x": 1,
+           "y": 0,
+           "z": 0,
+         },
+         "localZ": Object {
+           "x": 0,
+           "y": 1,
+           "z": 0,
+         },
+         "referenceAxis": "global-y",
+       },
+     },
+     "levels": Array [
+       Object {
+         "divisions": 1,
+         "elements": Array [
+           Object {
+             "elementId": "__mesh_1_e_0_0",
+             "end": 4,
+             "endNodeId": "node_0002",
+             "memberId": "member_0001",
+             "start": 0,
+             "startNodeId": "node_0001",
+           },
+           Object {
+             "elementId": "__mesh_1_e_1_0",
+             "end": 4,
+             "endNodeId": "node_0004",
+             "memberId": "member_0002",
+             "start": 0,
+             "startNodeId": "node_0003",
+           },
+         ],
+         "nodes": Array [],
+       },
+       Object {
+         "divisions": 2,
+         "elements": Array [
+           Object {
+             "elementId": "__mesh_2_e_0_0",
+             "end": 2,
+             "endNodeId": "__mesh_2_n_0_1",
+             "memberId": "member_0001",
+             "start": 0,
+             "startNodeId": "node_0001",
+           },
+           Object {
+             "elementId": "__mesh_2_e_0_1",
+             "end": 4,
+             "endNodeId": "node_0002",
+             "memberId": "member_0001",
+             "start": 2,
+             "startNodeId": "__mesh_2_n_0_1",
+           },
+           Object {
+             "elementId": "__mesh_2_e_1_0",
+             "end": 2,
+             "endNodeId": "__mesh_2_n_1_1",
+             "memberId": "member_0002",
+             "start": 0,
+             "startNodeId": "node_0003",
+           },
+           Object {
+             "elementId": "__mesh_2_e_1_1",
+             "end": 4,
+             "endNodeId": "node_0004",
+             "memberId": "member_0002",
+             "start": 2,
+             "startNodeId": "__mesh_2_n_1_1",
+           },
+         ],
+         "nodes": Array [
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_2_n_0_1",
+             "position": 2,
+           },
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_2_n_1_1",
+             "position": 2,
+           },
+         ],
+       },
+       Object {
+         "divisions": 4,
+         "elements": Array [
+           Object {
+             "elementId": "__mesh_4_e_0_0",
+             "end": 1,
+             "endNodeId": "__mesh_4_n_0_1",
+             "memberId": "member_0001",
+             "start": 0,
+             "startNodeId": "node_0001",
+           },
+           Object {
+             "elementId": "__mesh_4_e_0_1",
+             "end": 2,
+             "endNodeId": "__mesh_4_n_0_2",
+             "memberId": "member_0001",
+             "start": 1,
+             "startNodeId": "__mesh_4_n_0_1",
+           },
+           Object {
+             "elementId": "__mesh_4_e_0_2",
+             "end": 3,
+             "endNodeId": "__mesh_4_n_0_3",
+             "memberId": "member_0001",
+             "start": 2,
+             "startNodeId": "__mesh_4_n_0_2",
+           },
+           Object {
+             "elementId": "__mesh_4_e_0_3",
+             "end": 4,
+             "endNodeId": "node_0002",
+             "memberId": "member_0001",
+             "start": 3,
+             "startNodeId": "__mesh_4_n_0_3",
+           },
+           Object {
+             "elementId": "__mesh_4_e_1_0",
+             "end": 1,
+             "endNodeId": "__mesh_4_n_1_1",
+             "memberId": "member_0002",
+             "start": 0,
+             "startNodeId": "node_0003",
+           },
+           Object {
+             "elementId": "__mesh_4_e_1_1",
+             "end": 2,
+             "endNodeId": "__mesh_4_n_1_2",
+             "memberId": "member_0002",
+             "start": 1,
+             "startNodeId": "__mesh_4_n_1_1",
+           },
+           Object {
+             "elementId": "__mesh_4_e_1_2",
+             "end": 3,
+             "endNodeId": "__mesh_4_n_1_3",
+             "memberId": "member_0002",
+             "start": 2,
+             "startNodeId": "__mesh_4_n_1_2",
+           },
+           Object {
+             "elementId": "__mesh_4_e_1_3",
+             "end": 4,
+             "endNodeId": "node_0004",
+             "memberId": "member_0002",
+             "start": 3,
+             "startNodeId": "__mesh_4_n_1_3",
+           },
+         ],
+         "nodes": Array [
+           Object {
+             "fraction": 0.25,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_4_n_0_1",
+             "position": 1,
+           },
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_4_n_0_2",
+             "position": 2,
+           },
+           Object {
+             "fraction": 0.75,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_4_n_0_3",
+             "position": 3,
+           },
+           Object {
+             "fraction": 0.25,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_4_n_1_1",
+             "position": 1,
+           },
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_4_n_1_2",
+             "position": 2,
+           },
+           Object {
+             "fraction": 0.75,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_4_n_1_3",
+             "position": 3,
+           },
+         ],
+       },
+       Object {
+         "divisions": 8,
+         "elements": Array [
+           Object {
+             "elementId": "__mesh_8_e_0_0",
+             "end": 0.5,
+             "endNodeId": "__mesh_8_n_0_1",
+             "memberId": "member_0001",
+             "start": 0,
+             "startNodeId": "node_0001",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_1",
+             "end": 1,
+             "endNodeId": "__mesh_8_n_0_2",
+             "memberId": "member_0001",
+             "start": 0.5,
+             "startNodeId": "__mesh_8_n_0_1",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_2",
+             "end": 1.5,
+             "endNodeId": "__mesh_8_n_0_3",
+             "memberId": "member_0001",
+             "start": 1,
+             "startNodeId": "__mesh_8_n_0_2",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_3",
+             "end": 2,
+             "endNodeId": "__mesh_8_n_0_4",
+             "memberId": "member_0001",
+             "start": 1.5,
+             "startNodeId": "__mesh_8_n_0_3",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_4",
+             "end": 2.5,
+             "endNodeId": "__mesh_8_n_0_5",
+             "memberId": "member_0001",
+             "start": 2,
+             "startNodeId": "__mesh_8_n_0_4",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_5",
+             "end": 3,
+             "endNodeId": "__mesh_8_n_0_6",
+             "memberId": "member_0001",
+             "start": 2.5,
+             "startNodeId": "__mesh_8_n_0_5",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_6",
+             "end": 3.5,
+             "endNodeId": "__mesh_8_n_0_7",
+             "memberId": "member_0001",
+             "start": 3,
+             "startNodeId": "__mesh_8_n_0_6",
+           },
+           Object {
+             "elementId": "__mesh_8_e_0_7",
+             "end": 4,
+             "endNodeId": "node_0002",
+             "memberId": "member_0001",
+             "start": 3.5,
+             "startNodeId": "__mesh_8_n_0_7",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_0",
+             "end": 0.5,
+             "endNodeId": "__mesh_8_n_1_1",
+             "memberId": "member_0002",
+             "start": 0,
+             "startNodeId": "node_0003",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_1",
+             "end": 1,
+             "endNodeId": "__mesh_8_n_1_2",
+             "memberId": "member_0002",
+             "start": 0.5,
+             "startNodeId": "__mesh_8_n_1_1",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_2",
+             "end": 1.5,
+             "endNodeId": "__mesh_8_n_1_3",
+             "memberId": "member_0002",
+             "start": 1,
+             "startNodeId": "__mesh_8_n_1_2",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_3",
+             "end": 2,
+             "endNodeId": "__mesh_8_n_1_4",
+             "memberId": "member_0002",
+             "start": 1.5,
+             "startNodeId": "__mesh_8_n_1_3",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_4",
+             "end": 2.5,
+             "endNodeId": "__mesh_8_n_1_5",
+             "memberId": "member_0002",
+             "start": 2,
+             "startNodeId": "__mesh_8_n_1_4",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_5",
+             "end": 3,
+             "endNodeId": "__mesh_8_n_1_6",
+             "memberId": "member_0002",
+             "start": 2.5,
+             "startNodeId": "__mesh_8_n_1_5",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_6",
+             "end": 3.5,
+             "endNodeId": "__mesh_8_n_1_7",
+             "memberId": "member_0002",
+             "start": 3,
+             "startNodeId": "__mesh_8_n_1_6",
+           },
+           Object {
+             "elementId": "__mesh_8_e_1_7",
+             "end": 4,
+             "endNodeId": "node_0004",
+             "memberId": "member_0002",
+             "start": 3.5,
+             "startNodeId": "__mesh_8_n_1_7",
+           },
+         ],
+         "nodes": Array [
+           Object {
+             "fraction": 0.125,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_1",
+             "position": 0.5,
+           },
+           Object {
+             "fraction": 0.25,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_2",
+             "position": 1,
+           },
+           Object {
+             "fraction": 0.375,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_3",
+             "position": 1.5,
+           },
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_4",
+             "position": 2,
+           },
+           Object {
+             "fraction": 0.625,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_5",
+             "position": 2.5,
+           },
+           Object {
+             "fraction": 0.75,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_6",
+             "position": 3,
+           },
+           Object {
+             "fraction": 0.875,
+             "memberId": "member_0001",
+             "nodeId": "__mesh_8_n_0_7",
+             "position": 3.5,
+           },
+           Object {
+             "fraction": 0.125,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_1",
+             "position": 0.5,
+           },
+           Object {
+             "fraction": 0.25,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_2",
+             "position": 1,
+           },
+           Object {
+             "fraction": 0.375,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_3",
+             "position": 1.5,
+           },
+           Object {
+             "fraction": 0.5,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_4",
+             "position": 2,
+           },
+           Object {
+             "fraction": 0.625,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_5",
+             "position": 2.5,
+           },
+           Object {
+             "fraction": 0.75,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_6",
+             "position": 3,
+           },
+           Object {
+             "fraction": 0.875,
+             "memberId": "member_0002",
+             "nodeId": "__mesh_8_n_1_7",
+             "position": 3.5,
+           },
+         ],
+       },
+     ],
+     "policy": Object {
+       "displacementTolerance": 1e-12,
+       "forceTolerance": 1e-8,
+       "maxDivisions": 8,
+       "maxEquations": 12000,
+       "relativeTolerance": 0.000001,
+     },
+   },
    "nodalLoads": Array [
      Object {
        "force": Object {
          "x": 5,
          "y": 0,
@@ -160,13 +610,13 @@
        "z": -10,
      },
      "loadCaseId": "LC1",
    },
    "solver": Object {
-     "algorithm": "partial-pivot-gaussian",
+     "algorithm": "sparse-ldlt",
      "constraints": "free-dof-elimination",
-     "implementation": "framemind-frame/3",
+     "implementation": "framemind-native/4",
      "relativePivotTolerance": 1e-12,
    },
    "supports": Array [
      Object {
        "id": "support_0001",
```

# Test source

```ts
  84  |   await desktop(async (app, page, path) => {
  85  |     const project = columns(); const history = conversation(project);
  86  |     history.targets = [{ kind: "member", id: "member_0001" }];
  87  |     history.turns = [{ id: "queued-turn", origin: "chat", prompt: "修改选柱截面", context: captureAiSnapshot(project, history.targets).context, sourceProject: project, scheduledTaskId: "saved-queue" }];
  88  |     const scheduled = [{ id: "saved-queue", projectId: project.id, kind: "agent" as const, goal: "修改选柱截面", status: "queued" as const, queuedAt: 1, supplementCount: 0, operationCount: 1 }];
  89  |     await writeFile(path, encodeProject({ ...project, taskState: persistTaskState(project.id, [history], scheduled) }), "utf8");
  90  |     await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
  91  |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  92  |     await page.getByLabel("选择杆件 M2", { exact: true }).check();
  93  |     await replay(app, { sectionId: "section_0002", source: "user" }, "propose_section_change");
  94  |     await page.getByRole("button", { name: "继续任务", exact: true }).click();
  95  |     const card = page.getByRole("region", { name: "选柱截面修改方案" });
  96  |     await expect(card).toContainText("M1"); await expect(card).not.toContainText("M2");
  97  |     const saved = await save(page, path);
  98  |     expect(saved.taskState.scheduled.some((task: { id: string }) => task.id === "saved-queue")).toBe(false);
  99  |     expect(saved.members.map((member: { sectionId: string }) => member.sectionId)).toEqual(["section_0001", "section_0001"]);
  100 |   });
  101 | });
  102 | 
  103 | for (const stage of ["applied", "failed"] as const) test(`T2-09 resumes the saved ${stage} stage without resubmitting confirmed conditions`, async () => {
  104 |   const directory = await mkdtemp(join(tmpdir(), "framemind-t209-stage-"));
  105 |   const path = join(directory, "stage.framemind");
  106 |   const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  107 |   delete env.ELECTRON_RUN_AS_NODE;
  108 |   let app: ElectronApplication | undefined;
  109 |   try {
  110 |     const base = columns(); const saved = conversation(base); let project = base;
  111 |     if (stage === "applied") {
  112 |       const load = base.nodalLoads[0];
  113 |       const draft = proposeConditions({ supports: [], nodalLoads: [{ id: load.id, nodeId: load.nodeId, loadCaseId: load.loadCaseId, moment: load.moment, force: { x: 10, y: 0, z: 0 }, source: "user" }] });
  114 |       const result = new ConditionsStageConfirmation().confirm(base, prepareConditionsConfirmation(base, draft));
  115 |       expect(result.result.status, result.result.message).toBe("applied");
  116 |       project = result.project; saved.calculationRequested = true; saved.analysisSourceId = "LC1";
  117 |       saved.turns = [{ id: "confirmed", origin: "confirmation", prompt: "确认条件", sourceProject: base, context: result.result.context,
  118 |         result: { ...result.result, workKind: "agent", records: [{ round: 0, call: { id: "confirmed", type: "function", function: { name: "confirm_analysis_conditions", arguments: "{}" } }, result: result.result }] } }];
  119 |     } else {
  120 |       saved.turns = [{ id: "failed", origin: "chat", prompt: "读取当前模型", sourceProject: base, context: captureAiSnapshot(base, []).context,
  121 |         result: { status: "failed", workKind: "agent", message: "网络断开，任务未完成", context: captureAiSnapshot(base, []).context, records: [] } }];
  122 |     }
  123 |     await writeFile(path, encodeProject({ ...project, taskState: persistTaskState(project.id, [saved], []) }), "utf8");
  124 |     app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  125 |     await enterWorkbenchWithoutRecovery(page);
  126 |     await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
  127 |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  128 |     await page.getByRole("button", { name: "恢复任务", exact: true }).click();
  129 |     if (stage === "applied") {
  130 |       expect((await save(page, path)).analysisResults).toHaveLength(1);
  131 |       await page.getByRole("button", { name: "继续本地计算", exact: true }).click();
  132 |       await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
  133 |       const computed = await save(page, path);
  134 |       expect(computed.nodalLoads).toHaveLength(2); expect(computed.nodalLoads[0].force.x).toBe(10);
  135 |       expect(computed.confirmedOperations).toHaveLength(1); expect(computed.analysisResults).toHaveLength(2);
  136 |     } else {
  137 |       await expect(page.getByRole("button", { name: "重试消息", exact: true })).toBeEnabled();
  138 |       // No credential is available; local editing and solving still remain available.
  139 |       await page.getByRole("button", { name: "运行分析", exact: true }).click();
  140 |       await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
  141 |       expect((await save(page, path)).analysisResults).toHaveLength(2);
  142 |     }
  143 |   } finally {
  144 |     await app?.close();
  145 |     if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
  146 |     await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  147 |   }
  148 | });
  149 | 
  150 | test("T2-09 freezes an interrupted local calculation and resumes it offline only on request", async () => {
  151 |   const directory = await mkdtemp(join(tmpdir(), "framemind-t209-solve-"));
  152 |   const path = join(directory, "solve.framemind");
  153 |   const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  154 |   delete env.ELECTRON_RUN_AS_NODE;
  155 |   let app: ElectronApplication | undefined;
  156 |   const launch = async () => {
  157 |     app = await electron.launch({ args: ["."], env });
  158 |     const page = await app.firstWindow();
  159 |     await enterWorkbenchWithoutRecovery(page);
  160 |     await page.getByRole("button", { name: "文件", exact: true }).click();
  161 |     await page.getByRole("menuitem", { name: /打开项目/ }).click();
  162 |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  163 |     return page;
  164 |   };
  165 |   try {
  166 |     await writeFile(path, encodeProject(columns()), "utf8");
  167 |     let page = await launch();
  168 |     await page.evaluate(() => {
  169 |       const NativeWorker = window.Worker;
  170 |       window.Worker = class extends NativeWorker { postMessage() { /* Simulate exit while the numerical worker is still processing. */ } };
  171 |     });
  172 |     await page.getByRole("button", { name: "运行分析", exact: true }).click();
  173 |     await expect(page.getByRole("button", { name: "取消计算", exact: true })).toBeVisible();
  174 |     const interrupted = await save(page, path);
  175 |     expect(interrupted.taskState.analyses).toHaveLength(1);
  176 |     expect(interrupted.taskState.scheduled.some((task: { kind: string; status: string }) => task.kind === "analysis" && task.status === "running")).toBe(true);
  177 |     await app!.close(); page = await launch();
  178 |     await expect(page.getByRole("button", { name: "取消计算", exact: true })).toHaveCount(0);
  179 |     expect((await save(page, path)).analysisResults).toHaveLength(1);
  180 |     await page.getByRole("button", { name: "继续任务", exact: true }).click();
  181 |     await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
  182 |     const resumed = await save(page, path);
  183 |     expect(resumed.analysisResults).toHaveLength(2);
> 184 |     expect(resumed.analysisResults[1].input).toEqual(interrupted.taskState.analyses[0].input);
      |                                              ^ Error: expect(received).toEqual(expected) // deep equality
  185 |     expect(resumed.taskState.analyses).toHaveLength(0);
  186 |     await mkdir("docs/evidence/plan2/T2-09", { recursive: true });
  187 |     await page.screenshot({ path: "docs/evidence/plan2/T2-09/offline-resumed-analysis.png" });
  188 |   } finally {
  189 |     await app?.close();
  190 |     if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
  191 |     await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  192 |   }
  193 | });
  194 | 
```