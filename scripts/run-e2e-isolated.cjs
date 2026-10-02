const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, basename, sep } = require("node:path");

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-e2e-"));
  try {
    const args = [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)];
    const child = spawn(process.execPath, args, {
      stdio: "inherit", env: { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory },
    });
    process.exitCode = await new Promise((done, reject) => {
      child.once("error", reject); child.once("exit", (code) => done(code ?? 1));
    });
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("framemind-e2e-")) throw new Error("Invalid test profile cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
run().catch(() => { console.error("Isolated desktop test runner failed."); process.exitCode = 1; });
