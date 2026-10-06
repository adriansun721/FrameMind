import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as THREE from "three";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, addUniformLoad, createProject } from "../src/domain/project";
import { SECTION_REFERENCES } from "../src/validation/section-fixtures";
import { getSectionCatalogEntry } from "../src/domain/resource-library";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { save } from "./frame-proposal-actions";

function fixture() {
  let p = addMaterial(createProject("T2-24 true sections"), { name: "Steel", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  const sections = [...SECTION_REFERENCES.map(({ geometry }) => ({ name: geometry.shape, geometry })), getSectionCatalogEntry("arcelor-ipe200")!,
    { name: "Legacy properties", areaM2: .02, secondMomentYM4: .0001, secondMomentZM4: .0002, torsionalConstantM4: .0003 }];
  for (const [i, section] of sections.entries()) {
    p = addSection(p, section);
    p = addNode(p, { x: 0, y: i * .9, z: 0 });
    p = addNode(p, { x: 3, y: i * .9, z: i === 4 ? .6 : 0 });
    const start = p.nodes.at(-2)!, end = p.nodes.at(-1)!;
    p = addMember(p, { startNodeId: start.id, endNodeId: end.id, materialId: p.materials[0].id, sectionId: p.sections.at(-1)!.id, rotationDegrees: i === 2 ? 90 : i === 4 ? 30 : 0 });
    p = addSupport(p, start.id, [true, true, true, true, true, true]);
    p = addNodalLoad(p, end.id, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 0 });
  }
  p = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "local", loadCaseId: "LC1", intensity: { x: 0, y: 0, z: -1 } });
  return p;
}

async function open(page: Page) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: /打开项目/ }).click();
}

test("T2-24 default solids, line switching, mouse picking, themes and immutable analysis source", async () => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t224-")), path = join(directory, "rendering.framemind");
  const evidence = "docs/evidence/plan2/T2-24"; await mkdir(evidence, { recursive: true });
  const initial = fixture(); await writeFile(path, JSON.stringify(initial));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open(page);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.setBackgroundThrottling(false); });
    const viewport = page.getByLabel("三维模型视图"), controls = page.getByRole("group", { name: "构件显示" });
    await expect(controls.getByRole("button", { name: "实体", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(viewport).toContainText("梁单元分析"); await expect(viewport).toContainText("几何未定义构件用分析线");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const analyzed = await save(page, path);
    await page.getByRole("region", { name: "项目树" }).getByText("M3", { exact: true }).click();
    await expect(page.getByTestId("viewport-member-details")).toContainText(/90\s*°/);
    const canvas = await viewport.locator("canvas").elementHandle();
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole("button", { name: "适合模型", exact: true }).click();
        for (const mode of ["实体", "分析线"]) {
          await controls.getByRole("button", { name: mode, exact: true }).click();
          await expect(page.getByTestId("viewport-member-details")).toContainText(mode === "实体" ? "真实截面" : "分析线模型");
          await expect(page.getByRole("region", { name: "对象属性" })).toContainText("M3");
          await expect(page.getByTestId("viewport-node-count")).toHaveText("14 个节点");
          await expect(page.getByTestId("viewport-member-count")).toHaveText("7 根杆件");
          expect(await viewport.locator("canvas").evaluate((element, original) => element === original, canvas)).toBe(true);
          await page.screenshot({ path: join(evidence, `${mode === "实体" ? "solid" : "line"}-${theme}-${width}.png`) });
        }
      }
    }
    await controls.getByRole("button", { name: "实体", exact: true }).click();
    // Project a known engineering midpoint using the public camera state, then click it.
    const box = (await viewport.locator("canvas").boundingBox())!;
    await expect.poll(() => viewport.getAttribute("data-camera-state")).not.toBeNull();
    const values = (await viewport.getAttribute("data-camera-state"))!.split(",").map(Number);
    const camera = new THREE.PerspectiveCamera(42, box.width / box.height, .1, 200);
    camera.up.set(0, 0, 1); camera.position.set(values[0], values[1], values[2]); camera.lookAt(values[3], values[4], values[5]); camera.updateMatrixWorld();
    const midpoint = new THREE.Vector3(1.5, .9, 0).project(camera);
    await page.mouse.click(box.x + (midpoint.x + 1) * box.width / 2, box.y + (1 - midpoint.y) * box.height / 2 + 2);
    await expect(page.getByTestId("viewport-member-details")).toContainText("circle");
    await page.getByRole("region", { name: "项目树" }).getByText("M7", { exact: true }).click();
    await expect(page.getByTestId("viewport-member-details")).toContainText("几何未定义 · 分析线模型");
    await controls.getByRole("button", { name: "分析线", exact: true }).click();
    const saved = await save(page, path);
    expect(saved.nodes).toEqual(analyzed.nodes); expect(saved.members).toEqual(analyzed.members); expect(saved.sections).toEqual(analyzed.sections);
    expect(saved.revision).toBe(analyzed.revision); expect(saved.analysisResults).toEqual(analyzed.analysisResults); expect(saved.latestAnalysis).toEqual(analyzed.latestAnalysis);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, themes: ["dark", "light"], widths: [1440, 1080], modes: ["solid", "line"], members: 7, nodes: 14, mousePicking: true, canvasPreserved: true, immutableModelAndAnalysis: true, analysisId: saved.latestAnalysis.id }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});
