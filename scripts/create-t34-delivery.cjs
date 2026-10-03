const { readFile, writeFile, mkdir, copyFile, cp, rm, readdir } = require("node:fs/promises");
const { join, resolve, dirname, basename } = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const JSZip = require("jszip");

async function deliver() {
  const version = require("../package.json").version;
  const name = `FrameMind-${version}-Windows-x64`;
  const root = resolve("release");
  assert.equal(root, resolve(__dirname, "../release"), "Delivery must remain inside this repository");
  const folder = join(root, name);
  assert.equal(dirname(folder), root); assert.equal(basename(folder), name);
  const installer = `${name}-Setup.exe`;
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const acceptance = JSON.parse(await readFile("docs/evidence/T34/installation.json", "utf8"));
  assert.equal(acceptance.outcome, "passed", "Installation regression must have passed");
  assert.equal(acceptance.online, true, "Real online installed workflow must have passed");
  assert.equal(hash(await readFile(join(root, installer))), acceptance.installerSHA256, "Installer changed after acceptance");
  assert.equal(hash(await readFile("release-assets/manifest.json")), acceptance.deliveryManifestSHA256, "Delivery materials changed after installed acceptance");
  const layouts = JSON.parse(await readFile("docs/evidence/T34/workflow/layout-results.json", "utf8"));
  for (const mode of ["replay", "online"]) {
    for (const theme of ["dark", "light"]) {
      const key = `${mode}-${theme}`;
      const validation = JSON.parse(await readFile(`docs/evidence/T34/workflow/${key}/validation.json`, "utf8"));
      assert.equal(validation.outcome, "passed", `${key} workflow did not pass`);
      assert.equal(layouts[key]?.runId, validation.runId, `${key} layout belongs to an earlier run`);
      for (const format of ["word", "pdf"]) {
        assert.deepEqual(layouts[key][format].out_of_page, []);
        assert.deepEqual(layouts[key][format].missing_word_paragraphs, []);
        assert.equal(layouts[key][format].correct_analysis_id, true);
      }
      if (mode === "online") assert.equal(validation.installedArchiveSHA256, acceptance.archiveSHA256);
    }
  }
  const materials = JSON.parse(await readFile("release-assets/manifest.json", "utf8"));
  for (const [file, value] of Object.entries(materials.files)) assert.equal(hash(await readFile(join("release-assets", file))), value.sha256, `Delivery material changed: ${file}`);
  async function listFiles(directory, prefix = "") {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) result.push(...await listFiles(join(directory, entry.name), prefix + entry.name + "/"));
      else result.push(prefix + entry.name);
    }
    return result;
  }
  assert.deepEqual((await listFiles("release-assets")).sort(), ["manifest.json", ...Object.keys(materials.files)].sort(), "Unexpected delivery material");
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await copyFile(join(root, installer), join(folder, installer));
  await cp("release-assets", join(folder, "交付资料"), { recursive: true });
  await cp("docs/evidence/T34", join(folder, "安装验收"), { recursive: true });
  await mkdir(join(folder, "质量依据"));
  await copyFile("docs/decisions/0035-t34-windows-delivery.md", join(folder, "质量依据/ADR-0035.md"));
  const note = (await readFile("docs/evidence/T34-validation.md", "utf8"))
    .replaceAll("](T34/", "](安装验收/")
    .replaceAll("](../decisions/0035-t34-windows-delivery.md)", "](质量依据/ADR-0035.md)")
    .replaceAll("](../fixtures/t33-demo.json)", "](交付资料/质量证据/t33-demo.json)")
    .replaceAll("](../release/T34-acceptance.md)", "](交付资料/质量证据/T34-acceptance.md)");
  await writeFile(join(folder, "验收说明.md"), note);
  await mkdir(join(folder, "复验脚本"));
  for (const file of ["new-t34-sandbox.ps1", "t34-sandbox-smoke.ps1"]) await copyFile(join("scripts", file), join(folder, "复验脚本", file));
  const files = {}; const zip = new JSZip();
  async function collect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const key = prefix + entry.name;
      if (entry.isDirectory()) await collect(path, key + "/");
      else { const bytes = await readFile(path); files[key] = { bytes: bytes.length, sha256: hash(bytes) }; zip.file(key, bytes); }
    }
  }
  await collect(folder);
  const manifest = JSON.stringify({ version, releaseStatus: "candidate; clean Windows and AC-20 pending", installerSHA256: acceptance.installerSHA256,
    archiveSHA256: acceptance.archiveSHA256, installationRunId: acceptance.runId, files }, null, 2) + "\n";
  await writeFile(join(folder, "delivery-manifest.json"), manifest); zip.file("delivery-manifest.json", manifest);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await writeFile(join(root, `${name}-Delivery.zip`), bytes);
  await writeFile(join(root, "SHA256SUMS.txt"), `${acceptance.installerSHA256}  ${installer}\n${hash(bytes)}  ${name}-Delivery.zip\n`);
  console.log(`Delivery ZIP contains ${Object.keys(files).length} files; SHA256SUMS.txt written.`);
}
deliver().catch((error) => { console.error(error.message); process.exitCode = 1; });
