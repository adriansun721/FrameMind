import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createProject } from "../src/domain/project";
import { encodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import type { ReverseDesignRound } from "../electron/reverse-design-round-contract";

test("P25-10 desktop round records independent work and inspect or explicit unfinished offline status", async () => {
  test.setTimeout(300_000);
  const online = process.env.FRAMEMIND_P2510_ONLINE === "1";
  const directory = await mkdtemp(join(tmpdir(), "framemind-p2510-desktop-")), runId = randomUUID();
  const evidence = resolve("docs/evidence/plan2/P25-10/runs", `${runId}-${online ? "online" : "offline"}`);
  await mkdir(evidence, { recursive: true });
  const path = join(directory, "frame.framemind");
  await writeFile(path, encodeProject(createProject()));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let round: ReverseDesignRound | undefined;
  let status = "failed";
  const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  try {
    if (online) for (const name of ["deepseek.credentials", "Local State"]) await copyFile(join(process.env.APPDATA!, "framemind", name), join(directory, name));
    const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const action = async (name: string) => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click(); };
    await action("打开项目"); await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    await action("反向设计固定场景");
    const dialog = page.getByRole("dialog", { name: "反向设计固定场景", exact: true });
    await expect(dialog.getByRole("button", { name: "启动一轮三个 work 与 inspect", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "确认固定输入、变量、目标和预算", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("12 个节点");
    await dialog.getByRole("button", { name: "启动一轮三个 work 与 inspect", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "取消多 agent 轮次", exact: true })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "多 agent 轮次记录" })).toBeVisible({ timeout: 240_000 });
    const roundNames = await readdir(join(`${path}.git`, "rounds"));
    expect(roundNames).toHaveLength(1);
    round = JSON.parse(await readFile(join(`${path}.git`, "rounds", roundNames[0], "round.json"), "utf8")) as ReverseDesignRound;
    const tasks = await page.evaluate(() => window.frameMind.candidateTool({ tool: "list" }));
    const roundDirectory = join(`${path}.git`, "rounds", round.runId);
    for (const name of ["round.json", ...Object.keys(round.artifacts)]) await copyFile(join(roundDirectory, name), join(evidence, name));
    await dialog.getByRole("region", { name: "多 agent 轮次记录" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, "desktop.png") });
    expect(Array.isArray(tasks) && tasks.length === (online ? 3 : 0)).toBe(true);
    expect(round.mode).toBe("online");
    if (online) {
      expect(round.status).toBe("completed"); expect(round.works.every((w) => w.status === "completed")).toBe(true);
      expect(round.inspection?.reports).toHaveLength(3);
      expect(round.main.status).toBe("completed"); expect(round.main.apiCalls).toBeGreaterThan(0);
      const workIds = new Set(round.works.map((w) => w.agentId));
      const firstEnd = round.timeline.findIndex((e) => e.event === "api-end" && workIds.has(e.agentId));
      expect(round.timeline.slice(0, firstEnd).filter((e) => e.event === "api-start" && workIds.has(e.agentId))).toHaveLength(3);
      expect(new Set(round.works.map((w) => w.candidate?.parentCommit))).toEqual(new Set([round.parentCommit]));
    } else {
      expect(round.status).toBe("failed"); expect(round.main.status).toBe("failed"); expect(round.apiCalls).toBe(0);
      await expect(dialog.getByRole("region", { name: "多 agent 轮次记录" })).toContainText("禁止合并");
    }
    expect(round.decision).toBe("awaiting-P25-11");
    if (Array.isArray(tasks)) for (const task of tasks) {
      if (task.resultSha256) await copyFile(join(`${path}.git`, "candidates", task.taskId, "result.json"), join(evidence, `${task.taskId}-result.json`));
      const snapshot = await page.evaluate((taskId) => window.frameMind.candidateTool({ tool: "read", taskId }), task.taskId);
      if (!Array.isArray(snapshot) && "candidateContent" in snapshot) await writeFile(join(evidence, `${task.taskId}.framemind`), snapshot.candidateContent);
    }
    await dialog.getByRole("button", { name: "关闭反向设计", exact: true }).click(); await action("保存项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const formal = JSON.parse(await readFile(path, "utf8"));
    expect(formal.sections.map((s: { provenance: { catalogId: string } }) => s.provenance.catalogId)).toEqual(["arcelor-hea200", "arcelor-ipe200"]);
    await writeFile(join(evidence, "formal.framemind"), JSON.stringify(formal));
    status = "passed";
  } finally {
    const artifacts = Object.fromEntries(await Promise.all((await readdir(evidence)).filter((f) => f !== "run.json").map(async (f) => [f, hash(await readFile(join(evidence, f)))])));
    const files = ["electron/reverse-design-round.ts", "electron/reverse-design-round-contract.ts", "electron/project-candidates.ts", "electron/reverse-design.ts", "electron/deepseek.ts", "electron/native-analysis.ts", "electron/main.ts", "electron/preload.ts", "electron/contracts.ts", "scripts/reverse-native-domain.ts", "src/components/ReverseDesignDialog.tsx", "dist-electron/reverse-design-round.js", "dist-electron/reverse-native-domain.cjs", "native/bin/framemind-core.exe", "dist/index.html", ...(await readdir("dist/assets")).filter((f) => /\.(js|css)$/.test(f)).map((f) => `dist/assets/${f}`)];
    const sourceHashes = Object.fromEntries(await Promise.all(files.map(async (f) => [f, hash(await readFile(f))])));
    await writeFile(join(evidence, "run.json"), JSON.stringify({ task: "P25-10", runId, recordedAt: new Date().toISOString(), mode: online ? "online" : "offline-failure-regression", status,
      orchestrationStatus: round?.status ?? "not-run", artifacts, sourceHashes, reverify: "node scripts/verify-p25-10.mjs", onlineAcceptance: online && status === "passed" }, null, 2));
    if (app) await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe desktop test profile");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
