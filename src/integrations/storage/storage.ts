import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env.js";

export interface StoragePutInput {
  data: Buffer;
  contentType: string;
  name: string;
}

export interface StorageProvider {
  put(input: StoragePutInput): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const localProofKeyPrefix = "local:";

export function isLocalProofStorageKey(key: string): boolean {
  return key.startsWith(localProofKeyPrefix);
}

export class LocalFileStorageProvider implements StorageProvider {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async put(input: StoragePutInput): Promise<string> {
    const fileName = this.fileNameFromName(input.name);
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(this.filePath(fileName), input.data, { flag: "wx" });
    return `${localProofKeyPrefix}${fileName}`;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.filePathFromKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.filePathFromKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePathFromKey(key), { force: true });
  }

  private fileNameFromName(name: string): string {
    const fileName = path.basename(name);
    if (!fileName || fileName !== name || fileName === ".") {
      throw new Error("Nama berkas bukti tidak valid.");
    }
    return fileName;
  }

  private filePathFromKey(key: string): string {
    if (!isLocalProofStorageKey(key)) {
      throw new Error("Key bukti bukan berkas lokal.");
    }
    return this.filePath(this.fileNameFromName(key.slice(localProofKeyPrefix.length)));
  }

  private filePath(fileName: string): string {
    return path.join(this.rootDirectory, fileName);
  }
}

export function createStorageProvider(): StorageProvider {
  return new LocalFileStorageProvider(env.localProofStorageDirectory);
}

export function proofFileName(): string {
  return `proof-${randomUUID()}`;
}
