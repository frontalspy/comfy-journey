import { describe, expect, it } from "vitest";
import { encodeS3, presignGetUrl } from "./s3Signer.js";

// The example credentials and expected signature published in AWS's SigV4 documentation
// ("Authenticating Requests: Using Query Parameters").
const AWS_EXAMPLE = {
  credentials: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
  },
  date: new Date("2013-05-24T00:00:00Z"),
};

describe("presignGetUrl", () => {
  it("matches the signature AWS documents for its example request", () => {
    const url = presignGetUrl({
      ...AWS_EXAMPLE,
      origin: "https://examplebucket.s3.amazonaws.com",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      expiresSeconds: 86400,
    });
    expect(url).toContain(
      "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(url).toContain(
      "X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request",
    );
  });

  it("changes the signature when the path changes", () => {
    const sign = (path: string) =>
      presignGetUrl({
        ...AWS_EXAMPLE,
        origin: "https://h",
        host: "h",
        path,
        expiresSeconds: 60,
      });
    expect(sign("/a.png")).not.toBe(sign("/b.png"));
  });
});

describe("encodeS3", () => {
  it("encodes reserved characters and optionally keeps slashes", () => {
    expect(encodeS3("a b/c!")).toBe("a%20b%2Fc%21");
    expect(encodeS3("a b/c!", true)).toBe("a%20b/c%21");
  });
});
