const { _electron: electron } = require("playwright");
const { mkdir, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

async function capture() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "framemind-t02-evidence-"));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.FRAMEMIND_E2E_PROJECT_PATH = join(temporaryDirectory, "single-member.framemind");
  const application = await electron.launch({ args: ["."], env: environment });
  try {
    const window = await application.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    for (const point of [["0", "0", "0"], ["5", "2", "3"]]) {
      await window.getByRole("button", { name: "创建节点" }).click();
      const dialog = window.getByRole("dialog", { name: "创建空间节点" });
      await dialog.getByLabel("X 坐标").fill(point[0]);
      await dialog.getByLabel("Y 坐标").fill(point[1]);
      await dialog.getByLabel("Z 坐标").fill(point[2]);
      await dialog.getByRole("button", { name: "添加到模型" }).click();
    }
    await window.getByRole("button", { name: "创建材料与截面" }).click();
    await window.getByLabel("材料名称").fill("Q355");
    await window.getByLabel("截面名称").fill("箱形 300");
    await window.getByRole("button", { name: "保存材料与截面" }).click();
    await window.getByRole("button", { name: "创建杆件" }).click();
    await window.getByLabel("截面转角（°）").fill("25");
    await window.getByRole("button", { name: "添加杆件" }).click();
    await window.getByTestId("viewport-member-count").waitFor();
    const outputDirectory = resolve("docs/evidence");
    await mkdir(outputDirectory, { recursive: true });
    await window.screenshot({ path: join(outputDirectory, "T02-single-member.png"), animations: "disabled" });
  } finally {
    await application.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

capture().catch((error) => { console.error(error); process.exitCode = 1; });
