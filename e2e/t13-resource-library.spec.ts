import { expect, test } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T13 selects traceable catalog resources and preserves a custom derivative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t13-e2e-"));
  const projectPath = join(directory, "catalog.framemind");
  const environment: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_USER_DATA_PATH: directory };
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env: environment });
  const page = await app.firstWindow();
  await enterWorkbenchWithoutRecovery(page);

  await page.getByRole("button", { name: "创建材料与截面" }).click();
  const dialog = page.getByRole("dialog", { name: "创建材料与截面" });
  await dialog.getByLabel("库条目").nth(0).selectOption("en10025-s355jr");
  await dialog.getByLabel("库条目").nth(1).selectOption("arcelor-ipe200");
  await expect(dialog).toContainText("Sections and Merchant Bars");
  await expect(dialog).toContainText("Iy：关于局部 y 轴的二次面积矩");
  await dialog.getByRole("button", { name: "保存材料与截面" }).click();

  const properties = page.getByRole("region", { name: "对象属性" });
  await page.getByText("材料 M1 · S355JR", { exact: true }).click();
  await expect(properties).toContainText("已核对库条目");
  await expect(properties).toContainText("EN 10025-2:2019");
  await page.getByText("截面 S1 · IPE 200", { exact: true }).click();
  await expect(properties).toContainText("Iy：关于局部 y 轴的二次面积矩");
  await expect(properties).toContainText("Saint-Venant 扭转常数");
  await expect(properties).toContainText("正式分析采用目录参数");
  await properties.getByRole("button", { name: "编辑尺寸与共享影响" }).click();
  const review = page.getByRole("dialog", { name: "参数化截面管理" });
  await review.getByLabel("截面形状").selectOption("properties");
  await review.getByLabel("面积 A", { exact: true }).fill("0.003");
  await review.getByRole("button", { name: "预览截面影响" }).click();
  await review.getByRole("button", { name: "确认截面变更" }).click();
  await expect(properties).toContainText("自定义参数（由库条目修改）");

  await page.getByRole("button", { name: "文件" }).click();
  await page.getByRole("menu", { name: "文件" }).getByRole("menuitem", { name: /保存项目/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await app.close();

  const saved = JSON.parse(await readFile(projectPath, "utf8"));
  expect(saved.materials[0].provenance).toMatchObject({ kind: "catalog", catalogId: "en10025-s355jr" });
  expect(saved.sections[0].provenance).toMatchObject({ kind: "custom", derivedFrom: { catalogId: "arcelor-ipe200" } });
  expect(saved.sections[0].areaM2).toBe(0.003);
  expect(saved.sections[0].geometry).toBeUndefined();
  expect(saved.sections[0].catalogBasis).toBeUndefined();
  await rm(directory, { recursive: true, force: true });
});
