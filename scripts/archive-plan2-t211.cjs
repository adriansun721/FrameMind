const { readdir, readFile, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { gzipSync, gunzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");

async function archive() {
  const root = resolve(__dirname, "../docs/evidence/plan2/T2-11/runs");
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
    if (summary.status === "running") continue;
    let archives = [];
    try {
      const manifest = JSON.parse(await readFile(join(directory, "archives.json"), "utf8"));
      if (manifest.format !== "gzip" || !Array.isArray(manifest.files)) throw new Error("Invalid archive manifest");
      archives = manifest.files;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const entry of archives) {
      if (!/^(state-\d+|confirmation-\d+|diagnostic-\d+|contracts-\d+|desktop)\.json$/.test(entry.file) || entry.archive !== `${entry.file}.gz`) throw new Error("Invalid archive name");
      const compressed = await readFile(join(directory, entry.archive));
      const content = gunzipSync(compressed);
      if (content.length !== entry.bytes || compressed.length !== entry.compressedBytes || createHash("sha256").update(content).digest("hex") !== entry.sha256) throw new Error("Archive integrity mismatch");
    }
    for (const file of await readdir(directory)) {
      if (!/^(state-\d+|confirmation-\d+|diagnostic-\d+|contracts-\d+|desktop)\.json$/.test(file)) continue;
      const content = await readFile(join(directory, file));
      JSON.parse(content.toString("utf8"));
      const hash = createHash("sha256").update(content).digest("hex");
      const previous = archives.find((entry) => entry.file === file);
      if (previous) {
        if (previous.sha256 !== hash) throw new Error("Refusing to replace frozen evidence");
        continue;
      }
      let compressed;
      try {
        compressed = await readFile(join(directory, `${file}.gz`));
        if (!gunzipSync(compressed).equals(content)) throw new Error("Refusing to replace an existing archive");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        compressed = gzipSync(content, { level: 9 });
        await writeFile(join(directory, `${file}.gz`), compressed, { flag: "wx" });
      }
      // Keep the exact local JSON. Version control stores its lossless archive.
      archives.push({ file, archive: `${file}.gz`, bytes: content.length, compressedBytes: compressed.length,
        sha256: hash });
      count++;
    }
    await writeFile(join(directory, "archives.json"), JSON.stringify({ format: "gzip", uncompressedHash: "SHA-256", files: archives }, null, 2) + "\n");
  }
  console.log(`T2-11 verified existing archives and added ${count} complete JSON evidence files without changing their content.`);
}
archive().catch(() => { console.error("T2-11 evidence archival failed."); process.exitCode = 1; });
