import {
  access,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export interface FileOperations {
  access(path: string): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}

const nodeFileOperations: FileOperations = {
  access,
  readFile,
  rename,
  unlink,
  writeFile,
};

export class ProjectFileStore {
  private readonly files: FileOperations;

  constructor(overrides: Partial<FileOperations> = {}) {
    this.files = { ...nodeFileOperations, ...overrides };
  }

  async open(path: string): Promise<string> {
    return this.files.readFile(path, "utf8");
  }

  async save(path: string, content: string, encoding: BufferEncoding = "utf8"): Promise<void> {
    const suffix = randomUUID();
    const directory = dirname(path);
    const filename = basename(path);
    const temporaryPath = join(directory, `.${filename}.${suffix}.tmp`);
    const backupPath = join(directory, `.${filename}.${suffix}.bak`);
    let originalMoved = false;

    try {
      await this.files.writeFile(temporaryPath, content, encoding);
      if (await this.exists(path)) {
        await this.files.rename(path, backupPath);
        originalMoved = true;
      }
      await this.files.rename(temporaryPath, path);

      if (originalMoved) {
        await this.removeIfPresent(backupPath);
      }
    } catch (error) {
      if (originalMoved) {
        await this.removeIfPresent(path);
        await this.files.rename(backupPath, path);
      }
      await this.removeIfPresent(temporaryPath);
      throw error;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.files.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async removeIfPresent(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.files.unlink(path);
    }
  }
}
