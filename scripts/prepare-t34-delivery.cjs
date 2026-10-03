const { readFile, writeFile, mkdir, copyFile, rm } = require("node:fs/promises");
const { join, resolve, dirname, basename } = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");

async function prepare() {
  const output = resolve("release-assets");
  assert.equal(dirname(output), resolve(__dirname, ".."), "Staging must remain inside this repository");
  assert.equal(basename(output), "release-assets");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const source = resolve("docs/evidence/T33/replay-dark");
  const validation = JSON.parse(await readFile(join(source, "validation.json"), "utf8"));
  assert.equal(validation.outcome, "passed", "The fixed demonstration must have passed");
  assert.equal(createHash("sha256").update(await readFile("docs/fixtures/t33-demo.json")).digest("hex"), validation.fixtureSHA256,
    "Fixed inputs changed after demonstration acceptance");
  const entries = [
    [join(source, "before.framemind"), "示例项目/两层钢刚架-修改前.framemind"],
    [join(source, "after.framemind"), "示例项目/两层钢刚架-修改后.framemind"],
    [join(source, "计算书.docx"), "样例报告/两层钢刚架.docx"],
    [join(source, "计算书.pdf"), "样例报告/两层钢刚架.pdf"],
    ["docs/fixtures/t33-demo.json", "质量证据/t33-demo.json"],
    [join(source, "validation.json"), "质量证据/T33-replay-validation.json"],
    ["docs/evidence/T31-validation.md", "质量证据/T31-validation.md"],
    ["docs/evidence/T31-numerical-results.json", "质量证据/T31-numerical-results.json"],
    ["docs/evidence/T32-validation.md", "质量证据/T32-validation.md"],
    ["docs/evidence/T32-final-results.json", "质量证据/T32-final-results.json"],
    ["docs/evidence/T33-first-use.md", "质量证据/T33-first-use.md"],
    ["docs/release/T34-acceptance.md", "质量证据/T34-acceptance.md"],
    ["docs/release/Windows-quick-start.md", "启动与限制说明.md"],
  ];
  const files = {};
  for (const [path, name] of entries) {
    const bytes = await readFile(path);
    if (path.startsWith(source) && basename(path) !== "validation.json") {
      const expected = validation.artifacts?.[path.slice(source.length + 1)];
      assert.equal(typeof expected, "string", `Missing validated artifact hash: ${path}`);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `Stale demonstration: ${path}`);
    }
    const target = join(output, name);
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(path, target);
    files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ version: require("../package.json").version,
    fixture: validation.fixtureId, releaseStatus: "candidate; AC-20 and clean Windows acceptance pending", files }, null, 2) + "\n");
  console.log(`Prepared ${entries.length} delivery files with SHA-256 hashes.`);
}
prepare().catch((error) => { console.error(error.message); process.exitCode = 1; });
