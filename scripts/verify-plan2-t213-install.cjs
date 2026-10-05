const { spawn, execFileSync } = require("node:child_process");
const { readFile, writeFile, mkdtemp, readdir } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir, release } = require("node:os");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");

async function run(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: "inherit", ...options });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); });
  assert.equal(code, 0, `${command} exited ${code}`);
}
async function verify() {
  assert.equal(process.platform, "win32");
  const production = process.argv.includes("--t215");
  const evidence = production ? "docs/evidence/plan2/T2-15" : "docs/evidence/plan2/T2-13";
  const installer = resolve(`release/${production ? "t215" : "t213"}/FrameMind-${require("../package.json").version}-Windows-x64-Setup.exe`);
  // NSIS can redirect or remove an existing install during upgrade. Never use
  // that path for this local candidate acceptance.
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); foreach($root in $roots) { foreach($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) { if((Get-ItemProperty $key.PSPath).DisplayName -like 'FrameMind*') { throw 'Existing FrameMind installation: use an isolated Windows account' } } }"], { windowsHide: true });
  const directory = await mkdtemp(join(tmpdir(), "framemind-t213-install-"));
  const target = join(directory, "中文安装目录");
  const record = { generatedAt: new Date().toISOString(), platform: release(), installer, target, cleanWindows: false,
    limitation: "Developer host; application and native child PATH contains Windows System32 only. Clean Windows acceptance remains T2-44.", passed: false };
  let attempted = false;
  try {
    record.installerSha256 = createHash("sha256").update(await readFile(installer)).digest("hex");
    attempted = true;
    await run(installer, ["/S", `/D=${target}`]);
    const core = join(target, "resources/native/framemind-core.exe");
    const bytes = await readFile(core);
    record.coreSha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(record.coreSha256, createHash("sha256").update(await readFile("native/bin/framemind-core.exe")).digest("hex"));
    for (const file of ["COPYING.MPL2", "eigen.zip", "json.hpp", "THIRD_PARTY_NOTICES.md"]) assert.ok((await readFile(join(target, "resources/native", file))).length);
    await run(process.execPath, [require.resolve("@playwright/test/cli"), "test", production ? "e2e/plan2-t2-14-native.spec.ts" : "e2e/plan2-t2-13-native.spec.ts"], {
      env: { ...process.env, FRAMEMIND_INSTALLED_EXE: join(target, "FrameMind.exe"), ...(production ? { FRAMEMIND_T214_EVIDENCE: evidence } : {}) },
    });
    record.passed = true;
  } finally {
    if (attempted) {
      const uninstaller = (await readdir(target)).find((name) => /^Uninstall.*\.exe$/i.test(name));
      assert.ok(uninstaller, "Preserve candidate installation if no uninstaller is available");
      await run(join(target, uninstaller), ["/S", `_?=${target}`]);
      await assert.rejects(readFile(join(target, "FrameMind.exe")), { code: "ENOENT" });
      record.uninstalled = true;
    }
    await writeFile(`${evidence}/installation.json`, JSON.stringify(record, null, 2) + "\n");
  }
}
verify().catch((error) => { console.error(error); process.exitCode = 1; });
