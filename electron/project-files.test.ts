// @vitest-environment node
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectFileStore, type FileOperations } from "./project-files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("project file storage", () => {
  it("preserves the previous PDF bytes and removes temporary output when replacement fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-pdf-rollback-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "中文计算书.pdf");
    const original = Buffer.from("%PDF-1.7\noriginal\n%%EOF");
    await new ProjectFileStore().save(path, original.toString("base64"), "base64");
    const store = new ProjectFileStore({ rename: async (from, to) => {
      if (from.endsWith(".tmp")) throw new Error("target locked");
      await rename(from, to);
    } });
    await expect(store.save(path, Buffer.from("%PDF-1.7\nnew\n%%EOF").toString("base64"), "base64")).rejects.toThrow("target locked");
    expect(await readFile(path)).toEqual(original);
    expect(await readdir(directory)).toEqual(["中文计算书.pdf"]);
  });

  it("writes through a temporary file and reopens the exact saved content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-project-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "demo.framemind");
    const store = new ProjectFileStore();

    await store.save(target, '{"name":"Frame A"}\n');

    await expect(store.open(target)).resolves.toBe('{"name":"Frame A"}\n');
  });

  it("restores the original file when replacing it fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framemind-rollback-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "protected.framemind");
    const realStore = new ProjectFileStore();
    await realStore.save(target, "original");

    let renameCount = 0;
    const failingOperations: Partial<FileOperations> = {
      rename: async (from, to) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error("simulated replacement failure");
        }
        const { rename } = await import("node:fs/promises");
        await rename(from, to);
      },
    };

    await expect(
      new ProjectFileStore(failingOperations).save(target, "replacement"),
    ).rejects.toThrow("simulated replacement failure");
    await expect(readFile(target, "utf8")).resolves.toBe("original");
  });
});
