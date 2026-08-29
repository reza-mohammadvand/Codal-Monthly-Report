import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function cacheName(key, extension) {
  const digest = crypto.createHash("sha256").update(String(key)).digest("hex");
  return `${digest}.${extension}`;
}

export class DiskCache {
  constructor(rootDir, { refresh = false } = {}) {
    this.rootDir = rootDir;
    this.refresh = refresh;
  }

  filePath(key, extension = "dat") {
    return path.join(this.rootDir, cacheName(key, extension));
  }

  async getBuffer(key, extension = "dat") {
    if (this.refresh) return null;
    try {
      return await fs.readFile(this.filePath(key, extension));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async setBuffer(key, value, extension = "dat") {
    await fs.mkdir(this.rootDir, { recursive: true });
    const finalPath = this.filePath(key, extension);
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, value);
    await fs.rename(temporaryPath, finalPath);
    return finalPath;
  }

  async getText(key, extension = "txt") {
    const value = await this.getBuffer(key, extension);
    return value ? value.toString("utf8") : null;
  }

  async setText(key, value, extension = "txt") {
    return this.setBuffer(key, Buffer.from(String(value), "utf8"), extension);
  }

  async getJson(key) {
    const text = await this.getText(key, "json");
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async setJson(key, value) {
    return this.setText(key, JSON.stringify(value), "json");
  }
}
