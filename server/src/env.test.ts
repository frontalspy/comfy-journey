import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const dataDir = process.env.DATA_DIR ?? "";

describe("env validation", () => {
  it("applies the defaults: loopback, port 3000, no auth, disk media", () => {
    const env = parseEnv({ NODE_ENV: "test", DATA_DIR: dataDir });
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.AUTH_MODE).toBe("none");
    expect(env.MEDIA_STORE).toBe("disk");
    expect(env.COMFYUI_URL).toBe("http://127.0.0.1:8188");
    expect(env.ALLOW_NSFW_WORKFLOWS).toBe(true);
    expect(env.TRUSTED_PROXIES).toEqual(["127.0.0.1", "::1"]);
  });

  it("parses ALLOW_NSFW_WORKFLOWS=false and rejects a bad ComfyUI URL", () => {
    expect(
      parseEnv({ DATA_DIR: dataDir, ALLOW_NSFW_WORKFLOWS: "false" }).ALLOW_NSFW_WORKFLOWS,
    ).toBe(false);
    expect(() => parseEnv({ DATA_DIR: dataDir, COMFYUI_URL: "nope" })).toThrow();
  });

  it("accepts the four auth modes and nothing else", () => {
    for (const mode of ["none", "proxy-header", "token", "module"]) {
      expect(parseEnv({ DATA_DIR: dataDir, AUTH_MODE: mode }).AUTH_MODE).toBe(mode);
    }
    expect(() => parseEnv({ DATA_DIR: dataDir, AUTH_MODE: "open" })).toThrow();
  });

  it("lower-cases the proxy header and splits the trusted proxies", () => {
    const env = parseEnv({
      DATA_DIR: dataDir,
      AUTH_HEADER: "Remote-User",
      TRUSTED_PROXIES: "10.0.0.2, 10.0.0.3",
    });
    expect(env.AUTH_HEADER).toBe("remote-user");
    expect(env.TRUSTED_PROXIES).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  it("refuses the repo's real data directory during a test run", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).toThrow();
  });
});
