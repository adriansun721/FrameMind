import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releasedBeam } from "../src/validation/member-release-fixtures";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";
import { decodeProject } from "../src/domain/project-file";
import { isAnalysisResultCurrent } from "../src/domain/analysis";

test("T2-25 manual releases, markers, native result, undo, stale history and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t225-")), path = join(directory, "releases.framemind");
  const seed = releasedBeam(); await writeFile(path, JSON.stringify(seed));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-25"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open();
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await expect(page.getByLabel("终点弯矩释放", { exact: true })).toHaveValue("my");
    await expect(page.getByTestId("viewport-member-details")).toContainText("终点：释放 My");
    await page.getByLabel("起点弯矩释放", { exact: true }).selectOption("both");
    await page.getByLabel("终点弯矩释放", { exact: true }).selectOption("both");
    await page.getByRole("button", { name: "保存杆件属性", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 30000 });
    await save(page, path); let saved = decodeProject(await readFile(path, "utf8"));
    expect(saved.latestAnalysis!.input.solver!.implementation).toBe("framemind-native/4");
    expect(saved.latestAnalysis!.members[0].localEndForces.start[4]).toBeCloseTo(0, 9);
    expect(saved.latestAnalysis!.nodes[0].reaction.z).toBeCloseTo(4, 9);
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: join(evidence, `releases-${theme}-${width}.png`) });
      }
    }
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await page.getByLabel("起点弯矩释放", { exact: true }).selectOption("rigid");
    await page.getByRole("button", { name: "保存杆件属性", exact: true }).click();
    await save(page, path); saved = decodeProject(await readFile(path, "utf8"));
    expect(saved.members[0].endReleases!.start).toEqual({ my: false, mz: false });
    expect(saved.latestAnalysis!.input.members[0].endReleases!.start).toEqual({ my: true, mz: true });
    expect(isAnalysisResultCurrent(saved, saved.latestAnalysis!)).toBe(false);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await save(page, path); const undone = decodeProject(await readFile(path, "utf8"));
    expect(undone.members[0].endReleases!.start).toEqual({ my: true, mz: true });
    expect(isAnalysisResultCurrent(undone, undone.latestAnalysis!)).toBe(true);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await save(page, path);
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await expect(page.getByLabel("起点弯矩释放", { exact: true })).toHaveValue("rigid");
    await expect(page.getByLabel("终点弯矩释放", { exact: true })).toHaveValue("both");
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, project: saved }, null, 2));
  } finally { await app.close(); }
});

test("T2-25 agent release draft changes the formal member only after card confirmation", async () => {
  await desktop(async (app, page, path) => {
    const p = releasedBeam(); await writeFile(path, JSON.stringify(p));
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const endReleases = { start: { my: true, mz: false }, end: { my: false, mz: true } };
    await replay(app, { id: p.members[0].id, changes: { endReleases } }, "update_member");
    await send(page, "把 M1 起点局部 My、终点局部 Mz 释放，先核对草案");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card).toContainText("member_0001");
    const before = await save(page, path);
    expect(before.members[0].endReleases).toEqual(p.members[0].endReleases);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const after = await save(page, path);
    expect(after.members[0].endReleases).toEqual(endReleases);
    expect(after.supports).toEqual(p.supports);
  });
});
