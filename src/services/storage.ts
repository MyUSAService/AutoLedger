/**
 * File storage abstraction. Drivers: "local" (dev) and "s3"
 * (Cloudflare R2 or any S3-compatible endpoint, SSE at rest).
 * Original PDFs are always retained (§4 retention policy).
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private p(key: string) {
    const safe = key.replace(/\.\./g, "");
    return path.join(this.root, safe);
  }
  async put(key: string, data: Buffer) {
    const file = this.p(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
  async get(key: string) {
    return fs.readFile(this.p(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.p(key));
      return true;
    } catch {
      return false;
    }
  }
}

class S3Driver implements StorageDriver {
  private client: import("@aws-sdk/client-s3").S3Client | null = null;
  private async s3() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || "auto",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
      });
    }
    return this.client;
  }
  private bucket = () => process.env.S3_BUCKET!;
  async put(key: string, data: Buffer, contentType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.s3()).send(
      new PutObjectCommand({ Bucket: this.bucket(), Key: key, Body: data, ContentType: contentType })
    );
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async exists(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      await (await this.s3()).send(new HeadObjectCommand({ Bucket: this.bucket(), Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

let _driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!_driver) {
    _driver =
      (process.env.STORAGE_DRIVER || "local") === "s3"
        ? new S3Driver()
        : new LocalDriver(process.env.STORAGE_LOCAL_PATH || "./storage");
  }
  return _driver;
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function documentKey(engagementId: string, sha: string, filename: string): string {
  const ext = path.extname(filename) || ".pdf";
  return `engagements/${engagementId}/statements/${sha}${ext}`;
}
