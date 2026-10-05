import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as THREE from "three";
import { addNode, createProject, type Vector3 } from "../src/domain/project";
import { freeGeometryFixtures } from "../src/validation/free-geometry-fixtures";
import { decodeProject } from "../src/domain/project-file";
import { captureAiSnapshot, executeAiTool } from "../src/workspace/ai-tools";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}
async function numericPoint(page: Page, point: Vector3) {
  const form = page.getByRole("form", { name: "工作平面绘杆" });
  for (const axis of ["x", "y", "z"] as const) {
    const input = form.getByLabel(`绘杆 ${axis.toUpperCase()} 坐标`);
    if (await input.isEnabled()) await input.fill(String(point[axis]));
  }
}
async function screenPoint(page: Page, position: Vector3, topView = false) {
  const viewport = page.getByLabel("三维模型视图");
  const values = (await viewport.getAttribute("data-camera-state"))!.split(",").map(Number);
  const box = (await viewport.locator("canvas").boundingBox())!;
  const camera = new THREE.PerspectiveCamera(42, box.width / box.height, .1, 200);
  camera.up.set(0, topView ? 1 : 0, topView ? 0 : 1); camera.position.set(...values.slice(0, 3) as [number, number, number]);
  camera.lookAt(...values.slice(3, 6) as [number, number, number]); camera.updateMatrixWorld();
  const projected = new THREE.Vector3(position.x, position.y, position.z).project(camera);
  return { x: box.x + (projected.x + 1) * box.width / 2, y: box.y + (1 - projected.y) * box.height / 2 };
}

test("T2-19 numeric planes, preview isolation, units, continuous segments, undo and restart", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t219-")); const path = join(directory, "drawing.framemind");
  const fixture = freeGeometryFixtures()[0].project;
  const project = { ...createProject("工作平面绘杆"), materials: fixture.materials, sections: fixture.sections, nextMaterialNumber: 2, nextSectionNumber: 2 };
  await writeFile(path, JSON.stringify(project));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-19"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await page.getByRole("button", { name: "工作平面绘杆", exact: true }).click();
    const form = page.getByRole("form", { name: "工作平面绘杆" });
    await numericPoint(page, { x: -20.125, y: 2.5, z: 0 }); await form.getByRole("button", { name: "设为起点" }).click();
    await numericPoint(page, { x: -18.25, y: 3.75, z: 0 });
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(path, "utf8")).nodes).toHaveLength(0);
    await page.getByLabel("单位预设").selectOption("mm-N");
    await expect(form.getByLabel("绘杆 X 坐标")).toHaveValue("-18250");
    await form.getByRole("button", { name: "提交当前段" }).click();
    await expect(page.getByTestId("viewport-member-count")).toHaveText("1 根杆件");
    await expect(form.getByLabel("绘杆状态")).toContainText("起点 N2");
    await form.getByLabel("绘杆 X 坐标").fill("-17000"); await form.getByRole("button", { name: "提交当前段" }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("3 个节点");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
    await expect(form.getByLabel("绘杆状态")).toContainText("设置起点");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByLabel("单位预设").selectOption("m-kN");
    await form.getByLabel("工作平面", { exact: true }).selectOption("XZ"); await form.getByLabel("工作平面位置").fill("-35.125");
    await numericPoint(page, { x: 21.5, y: -35.125, z: -2.125 }); await form.getByRole("button", { name: "设为起点" }).click();
    await numericPoint(page, { x: 22.75, y: -35.125, z: .125 }); await form.getByRole("button", { name: "提交当前段" }).click();
    await form.getByLabel("工作平面", { exact: true }).selectOption("YZ"); await form.getByLabel("工作平面位置").fill("200.125");
    await numericPoint(page, { x: 200.125, y: -2.5, z: -1.125 }); await form.getByRole("button", { name: "设为起点" }).click();
    await numericPoint(page, { x: 200.125, y: .25, z: 3.75 }); await form.getByRole("button", { name: "提交当前段" }).click();
    await numericPoint(page, { x: 200.125, y: 2, z: 4 }); await page.keyboard.press("Escape");
    await expect(form.getByLabel("绘杆状态")).toContainText("设置起点");
    await form.getByLabel("工作平面位置").fill(""); await expect(form.getByRole("button", { name: "设为起点" })).toBeDisabled();
    await form.getByLabel("工作平面位置").fill("200.125");
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      if (theme === "light") { await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click(); await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); }
      for (const width of [1440, 1080]) {
        await page.setViewportSize({ width, height: 900 }); await page.getByRole("button", { name: "适合模型", exact: true }).click();
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        await page.screenshot({ path: join(evidence, `drawing-${theme}-${width}.png`) });
      }
    }
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8"));
    expect(saved.nodes.map((node) => node.position)).toEqual([{ x: -20.125, y: 2.5, z: 0 }, { x: -18.25, y: 3.75, z: 0 }, { x: -17, y: 3.75, z: 0 }, { x: 21.5, y: -35.125, z: -2.125 }, { x: 22.75, y: -35.125, z: .125 }, { x: 200.125, y: -2.5, z: -1.125 }, { x: 200.125, y: .25, z: 3.75 }]);
    expect(saved.members).toHaveLength(4); expect(saved.members[1].startNodeId).toBe(saved.members[0].endNodeId);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("7 个节点");
    await expect(page.getByRole("form", { name: "工作平面绘杆" })).toHaveCount(0);
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const reopened = decodeProject(await readFile(path, "utf8")); expect(reopened.nodes).toEqual(saved.nodes); expect(reopened.members).toEqual(saved.members);
    const read = executeAiTool(captureAiSnapshot(reopened, []), { id: "read", type: "function", function: { name: "read_model", arguments: '{"collection":"nodes"}' } });
    expect(read.status).toBe("completed"); expect(JSON.stringify(read.data)).toContain("200.125");
    await writeFile(join(evidence, "desktop-numeric.json"), JSON.stringify({ passed: true, nodes: saved.nodes, members: saved.members, previewExcluded: true, restartPreserved: true, agentReadStatus: read.status }, null, 2));
  } finally {
    await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true });
  }
});

test("T2-19 oblique mouse drawing and controllable node snapping on XY XZ YZ", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t219-mouse-")); const path = join(directory, "mouse.framemind");
  const fixture = freeGeometryFixtures()[0].project;
  let project = { ...createProject("鼠标绘杆"), materials: fixture.materials, sections: fixture.sections, nextMaterialNumber: 2, nextSectionNumber: 2 };
  for (const position of [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 4 }]) project = addNode(project, position);
  await writeFile(path, JSON.stringify(project)); const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await page.getByRole("button", { name: "切换 AI 对话" }).click(); await page.getByRole("button", { name: "适合模型", exact: true }).click();
    await page.getByRole("button", { name: "工作平面绘杆", exact: true }).click();
    const form = page.getByRole("form", { name: "工作平面绘杆" });
    for (const [plane, index] of [["XY", 2], ["XZ", 3], ["YZ", 3]] as const) {
      await form.getByLabel("工作平面", { exact: true }).selectOption(plane);
      const start = await screenPoint(page, project.nodes[0].position); const end = await screenPoint(page, project.nodes[index].position);
      await page.mouse.click(start.x, start.y); await expect(form.getByLabel("绘杆状态")).toContainText("起点 N1");
      await page.mouse.move(end.x + 5, end.y); await expect(form.getByLabel("绘杆状态")).toContainText(`捕捉 N${index + 1}`);
      await page.mouse.click(end.x + 5, end.y);
      await expect(page.getByTestId("viewport-node-count")).toHaveText("4 个节点");
    }
    for (const [plane, point] of [["XY", { x: 2, y: 2, z: 0 }], ["XZ", { x: 2, y: 0, z: 2 }], ["YZ", { x: 0, y: 2, z: 2 }]] as const) {
      await form.getByRole("button", { name: "取消当前段" }).click(); await form.getByLabel("工作平面", { exact: true }).selectOption(plane);
      const start = await screenPoint(page, project.nodes[0].position); const end = await screenPoint(page, point);
      await page.mouse.click(start.x, start.y); await page.mouse.move(end.x, end.y);
      await expect(form.getByLabel("绘杆状态")).toContainText("自由坐标");
      for (const axis of ["x", "y", "z"] as const) expect(Number(await form.getByLabel(`绘杆 ${axis.toUpperCase()} 坐标`).inputValue())).toBeCloseTo(point[axis], 5);
      await page.mouse.click(end.x, end.y);
    }
    await form.getByRole("button", { name: "取消当前段" }).click();
    await form.getByLabel("工作平面", { exact: true }).selectOption("XY");
    await form.getByLabel("捕捉已有节点", { exact: false }).uncheck();
    const start = await screenPoint(page, project.nodes[0].position); const end = await screenPoint(page, project.nodes[1].position);
    await page.mouse.click(start.x, start.y); await expect(form.getByLabel("绘杆状态")).toContainText("起点 未提交");
    await page.mouse.click(end.x, end.y); await expect(page.getByTestId("viewport-node-count")).toHaveText("9 个节点");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8")); expect(saved.members).toHaveLength(7); expect(saved.nodes.slice(7).every((node) => node.position.z === 0)).toBe(true);
    expect(saved.members.slice(0, 3).every((member) => member.startNodeId === project.nodes[0].id)).toBe(true);
    expect(saved.members[6].startNodeId).not.toBe(project.nodes[0].id);
    await page.screenshot({ path: "docs/evidence/plan2/T2-19/mouse-oblique.png" });
    await form.getByRole("button", { name: "取消当前段" }).click(); await form.getByLabel("捕捉已有节点", { exact: false }).check();
    await form.getByRole("button", { name: "正对平面" }).click();
    const aligned = (await page.getByLabel("三维模型视图").getAttribute("data-camera-state"))!.split(",").map(Number);
    expect(Math.abs(aligned[0] - aligned[3])).toBeLessThan(.001);
    expect(Math.abs(aligned[1] - aligned[4])).toBeLessThan(.001);
    const normalStart = await screenPoint(page, project.nodes[2].position, true);
    await page.mouse.click(normalStart.x, normalStart.y); await expect(form.getByLabel("绘杆状态")).toContainText("起点 N3");
    await page.mouse.wheel(0, -100);
    await page.evaluate(() => new Promise<void>((done) => { let frames = 0; const step = () => ++frames > 60 ? done() : requestAnimationFrame(step); step(); }));
    const zoomed = (await page.getByLabel("三维模型视图").getAttribute("data-camera-state"))!.split(",").map(Number);
    expect(Math.abs(zoomed[0] - zoomed[3])).toBeLessThan(.001);
    expect(Math.abs(zoomed[1] - zoomed[4])).toBeLessThan(.001);
    const normalEnd = await screenPoint(page, project.nodes[1].position, true);
    await page.mouse.click(normalEnd.x + 5, normalEnd.y); await expect(page.getByTestId("viewport-node-count")).toHaveText("9 个节点");
    await expect(page.getByTestId("viewport-member-count")).toHaveText("8 根杆件");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const final = decodeProject(await readFile(path, "utf8"));
    await mkdir("docs/evidence/plan2/T2-19", { recursive: true });
    await page.screenshot({ path: "docs/evidence/plan2/T2-19/mouse-normal-zoom.png" });
    await writeFile("docs/evidence/plan2/T2-19/desktop-mouse.json", JSON.stringify({ passed: true, planes: ["XY", "XZ", "YZ"], freeRayCoordinatesChecked: true, snapReusedIdentity: true, snapOffCreatesSeparateIdentity: true, normalViewAndZoomPreserveIdentity: true, nodes: final.nodes, members: final.members }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});
