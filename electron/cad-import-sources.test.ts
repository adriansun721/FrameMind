// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CadImportSources } from "./cad-import-sources";

it("confirmation refuses a changed, missing, foreign or expired STEP source", async () => {
  const root = await mkdtemp(join(tmpdir(), "cad-import-source-")), path = join(root, "input.step");
  try {
    const input = "frozen input", sha256 = createHash("sha256").update(input).digest("hex"), sources = new CadImportSources();
    await writeFile(path, input); sources.register(1, "cad_12345678", path, sha256);
    await expect(sources.verify(1, { requestId: "cad_12345678", inputSha256: sha256 })).resolves.toBeUndefined();
    await expect(sources.verify(2, { requestId: "cad_12345678", inputSha256: sha256 })).rejects.toThrow(/会话/);
    await writeFile(path, "modified input");
    await expect(sources.verify(1, { requestId: "cad_12345678", inputSha256: sha256 })).rejects.toThrow(/变化/);
    await rm(path);
    await expect(sources.verify(1, { requestId: "cad_12345678", inputSha256: sha256 })).rejects.toThrow(/缺失/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
