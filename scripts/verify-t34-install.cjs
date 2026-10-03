const { spawn } = require("node:child_process");
const { readFile, writeFile, mkdir, mkdtemp, rm, readdir } = require("node:fs/promises");
const { join, resolve, sep, basename } = require("node:path");
const { tmpdir, release } = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const { runT33 } = require("./t33-workflow.cjs");

async function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...options });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
  assert.equal(code, 0, `${basename(command)} failed (${code})`);
}
const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
async function listFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(join(directory, entry.name), name + "/"));
    else result.push(name);
  }
  return result;
}

async function verify() {
  assert.equal(process.platform, "win32", "Windows installation acceptance requires Windows");
  const version = require("../package.json").version;
  const installer = resolve(`release/FrameMind-${version}-Windows-x64-Setup.exe`);
  const output = resolve("docs/evidence/T34");
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(tmpdir(), "framemind-t34-install-"));
  const target = join(directory, "中文安装目录");
  const executablePath = join(target, "FrameMind.exe");
  const record = { runId: randomUUID(), startedAt: new Date().toISOString(), outcome: "running", version,
    os: release(), architecture: process.arch, installer, installationDirectory: target,
    cleanMachine: false, cleanMachineReason: "Developer host, fresh application profiles and PATH stripped in offline tests; Windows Sandbox unavailable",
    online: process.argv.includes("--online"), firstUse: "Pending real participant (AC-20)" };
  const recordPath = join(output, "installation.json");
  await writeFile(recordPath, JSON.stringify(record, null, 2));
  let installed = false;
  async function uninstall() {
    const names = await readdir(target);
    const uninstaller = names.find((name) => /^Uninstall.*\.exe$/i.test(name));
    assert.ok(uninstaller, "Missing uninstaller");
    // _?= keeps NSIS in this process, so exit means uninstall has finished.
    await run(join(target, uninstaller), ["/S", `_?=${target}`]);
    await assert.rejects(readFile(executablePath), { code: "ENOENT" });
    installed = false;
  }
  try {
    record.installerSHA256 = await hash(installer);
    // Never redirect an existing installation: NSIS upgrades can remove its previous directory.
    await run("powershell.exe", ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; $roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); foreach ($root in $roots) { $keys = Get-ChildItem $root -ErrorAction SilentlyContinue; foreach ($key in $keys) { $entry = Get-ItemProperty $key.PSPath; if ($entry.DisplayName -like 'FrameMind*') { throw 'Existing FrameMind installation found; use an isolated Windows user for acceptance' } } }"]);
    // A nonzero installer may already have registered an application. Preserve it unless uninstall succeeds.
    installed = true;
    await run(installer, ["/S", `/D=${target}`]);
    record.executableSHA256 = await hash(executablePath);
    record.archiveSHA256 = await hash(join(target, "resources/app.asar"));
    const bundled = JSON.parse(await readFile(join(target, "resources/交付资料/manifest.json"), "utf8"));
    record.deliveryManifestSHA256 = await hash(join(target, "resources/交付资料/manifest.json"));
    assert.deepEqual((await listFiles(join(target, "resources/交付资料"))).sort(), ["manifest.json", ...Object.keys(bundled.files)].sort(), "Unexpected bundled delivery files");
    for (const [name, value] of Object.entries(bundled.files)) {
      assert.equal(await hash(join(target, "resources/交付资料", name)), value.sha256, `Bundled file changed: ${name}`);
    }
    record.deliveryFiles = Object.keys(bundled.files).length;
    await run(process.execPath, [require.resolve("@playwright/test/cli"), "test", "e2e/t34-installed-offline.spec.ts", "--output", resolve("release/t34-test-results")], {
      env: { ...process.env, FRAMEMIND_INSTALLED_EXE: executablePath },
    });
    record.offline = "passed: unconfigured, removed credential, disconnected, Chinese paths, both themes, restart, exports, real Worker cancellation/retry";
    for (const theme of ["dark", "light"]) {
      const result = await runT33({ theme, executablePath, online: record.online, evidenceRoot: "docs/evidence/T34/workflow" });
      assert.equal(result.outcome, "passed");
    }
    record.completeWorkflow = record.online ? "passed: real DeepSeek HTTPS in both themes" : "passed: fixed HTTP tool replay in both themes (not real online acceptance)";
    await uninstall();
    record.uninstall = "passed";
    record.outcome = "passed";
  } catch (error) {
    record.outcome = "failed";
    record.failure = { type: error.name, message: error.message };
    throw error;
  } finally {
    if (installed) {
      try { await uninstall(); record.failureCleanup = "uninstalled"; }
      catch (error) { record.cleanupFailure = error.message; process.exitCode = 1; }
    }
    record.finishedAt = new Date().toISOString();
    await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
    // Never remove a registered application by recursive deletion.
    if (!installed) {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t34-install-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
