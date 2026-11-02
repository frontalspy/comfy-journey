import {
  assertMediaKey,
  MAX_MEDIA_BYTES,
  type MediaArea,
  type MediaBackend,
  MediaStorageError,
} from "./mediaBackend.js";
import { encodeS3, presignGetUrl, type S3Credentials, signedHeaders } from "./s3Signer.js";

export interface S3Config {
  bucket: string;
  region: string;
  /** A non-AWS service's address (path-style addressing). Unset means AWS S3. */
  endpoint?: string;
  /** Key prefix inside the bucket, so one bucket can hold several installs. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3BackendOptions {
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Reads are redirects to presigned URLs; keep them valid longer than the browser caches them. */
const PRESIGN_SECONDS = 2 * 60 * 60;

/**
 * Media in an S3-compatible bucket. The bucket stays private: the app writes with its own
 * credentials and hands the browser short-lived signed links, after its own owner check.
 */
export class S3MediaBackend implements MediaBackend {
  readonly kind = "s3" as const;
  private readonly credentials: S3Credentials;
  private readonly host: string;
  private readonly origin: string;
  private readonly bucketPath: string;
  private readonly prefix: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;

  constructor(config: S3Config, options: S3BackendOptions = {}) {
    this.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
    };
    if (config.endpoint) {
      const url = new URL(config.endpoint);
      this.origin = url.origin;
      this.host = url.host;
      this.bucketPath = `/${encodeS3(config.bucket)}`;
    } else {
      this.host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      this.origin = `https://${this.host}`;
      this.bucketPath = "";
    }
    this.prefix = config.prefix.replace(/^\/+|\/+$/g, "");
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private path(area: MediaArea, key: string): string {
    assertMediaKey(key);
    const objectKey = [this.prefix, area, key].filter(Boolean).join("/");
    return `${this.bucketPath}/${encodeS3(objectKey, true)}`;
  }

  private async send(
    method: string,
    path: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const headers = signedHeaders({
      method,
      path,
      host: this.host,
      credentials: this.credentials,
      date: this.now(),
      body,
      contentType,
    });
    // fetch sets Host itself, from the same URL the signature covers.
    const { host: _host, ...sendable } = headers;
    try {
      return await this.doFetch(`${this.origin}${path}`, {
        method,
        headers: sendable,
        body: body as RequestInit["body"],
      });
    } catch {
      throw new MediaStorageError();
    }
  }

  async put(area: MediaArea, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send("PUT", this.path(area, key), bytes, contentType);
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) throw new MediaStorageError();
  }

  async read(
    area: MediaArea,
    key: string,
    maxBytes = MAX_MEDIA_BYTES,
  ): Promise<Buffer | undefined> {
    const res = await this.send("GET", this.path(area, key));
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new MediaStorageError();
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new MediaStorageError("Stored media is too large.");
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new MediaStorageError("Stored media is too large.");
    return bytes;
  }

  async head(area: MediaArea, key: string): Promise<{ size: number } | null> {
    const res = await this.send("HEAD", this.path(area, key));
    if (res.status === 404) return null;
    if (!res.ok) throw new MediaStorageError();
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async remove(area: MediaArea, key: string): Promise<void> {
    const res = await this.send("DELETE", this.path(area, key));
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok && res.status !== 404) throw new MediaStorageError();
  }

  publicUrl(area: MediaArea, key: string): string {
    return presignGetUrl({
      origin: this.origin,
      host: this.host,
      path: this.path(area, key),
      credentials: this.credentials,
      date: this.now(),
      expiresSeconds: PRESIGN_SECONDS,
    });
  }
}
