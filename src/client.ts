import { Storage, type Bucket } from "@google-cloud/storage";
import type { BucketKeyvalOptions } from "./types.js";

export class BucketKeyval {
  private bucket: Bucket;
  private prefix: string;

  constructor(options: BucketKeyvalOptions) {
    const storage = new Storage(options.storageOptions);
    this.bucket = storage.bucket(options.bucketName);
    this.prefix = options.prefix ? options.prefix.replace(/\/+$/, "") + "/" : "";
  }

  private objectPath(key: string): string {
    return this.prefix + key;
  }

  private stripPrefix(objectName: string): string {
    return this.prefix ? objectName.slice(this.prefix.length) : objectName;
  }

  async set(key: string, value: unknown): Promise<"OK"> {
    const data = JSON.stringify(value);
    const file = this.bucket.file(this.objectPath(key));
    await file.save(data, { contentType: "application/json" });
    return "OK";
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const file = this.bucket.file(this.objectPath(key));
    try {
      const [contents] = await file.download();
      return JSON.parse(contents.toString()) as T;
    } catch (err: unknown) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    await Promise.all(
      keys.map(async (key) => {
        const file = this.bucket.file(this.objectPath(key));
        try {
          await file.delete();
          deleted++;
        } catch (err: unknown) {
          if (!isNotFoundError(err)) throw err;
        }
      }),
    );
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    await Promise.all(
      keys.map(async (key) => {
        const file = this.bucket.file(this.objectPath(key));
        const [exists] = await file.exists();
        if (exists) count++;
      }),
    );
    return count;
  }

  async keys(pattern = "*"): Promise<string[]> {
    const staticPrefix = extractStaticPrefix(pattern);
    const searchPrefix = this.prefix + staticPrefix;

    const [files] = await this.bucket.getFiles({
      prefix: searchPrefix || undefined,
    });

    const regex = globToRegex(pattern);
    return files
      .map((f) => this.stripPrefix(f.name))
      .filter((name) => regex.test(name));
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 404
  );
}

function extractStaticPrefix(pattern: string): string {
  const firstWildcard = pattern.search(/[*?[\]]/);
  if (firstWildcard === -1) return pattern;
  const lastSlash = pattern.lastIndexOf("/", firstWildcard);
  return lastSlash === -1 ? "" : pattern.slice(0, lastSlash + 1);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`);
}
