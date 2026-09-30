const { _electron: electron } = require("playwright");
const { mkdir, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

async function capture() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "framemind-evidence-"));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.FRAMEMIND_E2E_PROJECT_PATH = join(temporaryDirectory, "evidence.framemind");

  const application = await electron.launch({ args: ["."], env: environment });
  try {
    const window = await application.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await window.getByRole("button", { name: "创建节点" }).click();
    await window.getByLabel("X 坐标").fill("1.25");
    await window.getByLabel("Y 坐标").fill("-2");
    await window.getByLabel("Z 坐标").fill("3.5");
    await window.getByRole("button", { name: "添加到模型" }).click();
    await window.getByTestId("viewport-node-count").waitFor();

    const outputDirectory = resolve("docs/evidence");
    await mkdir(outputDirectory, { recursive: true });
    await window.screenshot({
      path: join(outputDirectory, "T01-workbench.png"),
      animations: "disabled",
    });
  } finally {
    await application.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
