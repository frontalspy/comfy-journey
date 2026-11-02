import { createHash, createHmac } from "node:crypto";

/** AWS Signature Version 4 for S3, on node:crypto only. Works with any S3-compatible service. */

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it. `slash` keeps "/" literal for object paths. */
export function encodeS3(value: string, slash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return slash ? encoded.replace(/%2F/g, "/") : encoded;
}

/** "20130524T000000Z" and "20130524". */
function stamps(date: Date): { amzDate: string; day: string } {
  const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signingKey(secret: string, day: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => [encodeS3(key), encodeS3(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

interface SignInput {
  method: string;
  /** Already-encoded absolute path, e.g. "/bucket/a/b.png". */
  path: string;
  host: string;
  credentials: S3Credentials;
  date: Date;
}

/** A presigned GET URL, valid for `expiresSeconds`. Pure: no network. */
export function presignGetUrl(
  input: Omit<SignInput, "method"> & { origin: string; expiresSeconds: number },
): string {
  const { amzDate, day } = stamps(input.date);
  const scope = `${day}/${input.credentials.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const query = canonicalQuery(params);
  const canonical = [
    "GET",
    input.path,
    query,
    `host:${input.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(input.credentials.secretAccessKey, day, input.credentials.region),
  )
    .update(toSign)
    .digest("hex");
  return `${input.origin}${input.path}?${query}&X-Amz-Signature=${signature}`;
}

/** Headers (including Authorization) for a request carrying `body`. */
export function signedHeaders(
  input: SignInput & { body?: Uint8Array; contentType?: string },
): Record<string, string> {
  const { amzDate, day } = stamps(input.date);
  const scope = `${day}/${input.credentials.region}/s3/aws4_request`;
  const payloadHash = sha256Hex(input.body ?? "");
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.contentType) headers["content-type"] = input.contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedList = names.join(";");
  const canonical = [input.method, input.path, "", canonicalHeaders, signedList, payloadHash].join(
    "\n",
  );
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(input.credentials.secretAccessKey, day, input.credentials.region),
  )
    .update(toSign)
    .digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedList}, Signature=${signature}`;
  return headers;
}
