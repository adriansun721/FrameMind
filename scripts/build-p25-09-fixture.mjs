import { rolldown } from "rolldown";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
const directory = await mkdtemp(join(tmpdir(), "framemind-p2509-fixture-"));
try {
  const bundle = await rolldown({ input: "scripts/create-p25-09-fixture.ts", platform: "node" });
  const file = join(directory, "fixture.cjs");
  await bundle.write({ file, format: "cjs" });
  await bundle.close();
  const run = spawnSync(process.execPath, [file], { stdio: "inherit", windowsHide: true });
  if (run.status !== 0) throw new Error("Fixture generation failed");
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid fixture directory");
  await rm(directory, { recursive: true, force: true });
}
