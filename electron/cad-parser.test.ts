import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CadParserHost } from "./cad-parser";

const worker = join(process.cwd(), "scripts", "cad-parser-worker.mjs");
const validStep = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('FrameMind test'),'2;1');\nFILE_NAME('fixture.step','2026-10-09T00:00:00',('a'),('b'),'FrameMind','FrameMind','');\nFILE_SCHEMA(('AP203'));\nENDSEC;\nDATA;\n#10=PRODUCT('assembly',$,$,$);\n#20=MANIFOLD_SOLID_BREP('solid',$);\n#30=NEXT_ASSEMBLY_USAGE_OCCURRENCE('instance',$,$,#10,#20,$);\nENDSEC;\nEND-ISO-10303-21;\n`;

describe("CadParserHost", () => {
  it("parses the actual STEP bytes in an isolated worker and returns a bounded intermediate result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-cad-"));
    const input = join(directory, "fixture.step");
    await writeFile(input, validStep);
    try {
      const messages = await new CadParserHost({ worker }).run(101, { requestId: "cad_test1234", inputPath: input });
      expect(messages.map((message) => message.kind)).toEqual(["phase", "phase", "phase", "result"]);
      const result = messages.at(-1);
      expect(result?.kind).toBe("result");
      if (result?.kind === "result") {
        expect(result.diagnostics).toMatchObject({ products: 1, solidBreps: 1, assemblyInstances: 1 });
        expect(result.input.sizeBytes).toBe(Buffer.byteLength(validStep));
        expect(JSON.stringify(result)).not.toContain(input);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("contains malformed input failures and leaves the input untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-cad-"));
    const input = join(directory, "broken.stp");
    await writeFile(input, "not a STEP document");
    try {
      const before = await readFile(input, "utf8");
      const messages = await new CadParserHost({ worker }).run(102, { requestId: "cad_test5678", inputPath: input });
      const result = messages.at(-1);
      expect(result?.kind).toBe("error");
      if (result?.kind === "error") expect(result.error.code).toBe("cad-invalid-step");
      await expect(readFile(input, "utf8")).resolves.toBe(before);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports a local entity failure with its entity location", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-cad-"));
    const input = join(directory, "partial.step");
    await writeFile(input, validStep.replace("#20=MANIFOLD_SOLID_BREP('solid',$);", "#20 = ;"));
    try {
      const messages = await new CadParserHost({ worker }).run(106, { requestId: "cad_partial1", inputPath: input });
      expect(messages.at(-1)).toMatchObject({ kind: "error", error: { code: "cad-partial-entity", entityId: 20, line: expect.any(Number) } });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports missing files without starting a parser and uses a new task for retry", async () => {
    const host = new CadParserHost({ worker });
    const first = await host.run(103, { requestId: "cad_missing1", inputPath: join(tmpdir(), "does-not-exist.step") });
    const second = await host.run(103, { requestId: "cad_missing2", inputPath: join(tmpdir(), "does-not-exist.step") });
    expect(first.at(-1)).toMatchObject({ kind: "error", error: { code: "cad-input-unreadable" } });
    expect(second.at(-1)).toMatchObject({ kind: "error", error: { code: "cad-input-unreadable" } });
    expect(first.at(-1)).not.toEqual(second.at(-1));
  });

  it("contains a worker timeout and crash as structured failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-cad-"));
    const input = join(directory, "fixture.step");
    const hanging = join(directory, "hanging.mjs");
    const crashing = join(directory, "crashing.mjs");
    await writeFile(input, validStep);
    await writeFile(hanging, "process.stdin.resume(); setInterval(() => {}, 1000);\n");
    await writeFile(crashing, "process.exit(9);\n");
    try {
      const timedOut = await new CadParserHost({ worker: hanging, timeoutMs: 30 }).run(104, { requestId: "cad_timeout1", inputPath: input });
      const crashed = await new CadParserHost({ worker: crashing, timeoutMs: 1000 }).run(105, { requestId: "cad_crash001", inputPath: input });
      expect(timedOut.at(-1)).toMatchObject({ kind: "error", error: { code: "cad-timeout", parserVersion: expect.any(String) } });
      expect(crashed.at(-1)).toMatchObject({ kind: "error", error: { code: "cad-crash", parserVersion: expect.any(String) } });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
