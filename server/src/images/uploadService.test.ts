import { describe, expect, it } from "vitest";
import { sanitiseUploadName } from "./uploadService.js";

describe("sanitiseUploadName", () => {
  it("keeps only the file name, without a path or control characters", () => {
    expect(sanitiseUploadName("C:\\Users\\me\\pics\\cat.png")).toBe("cat.png");
    expect(sanitiseUploadName("../../etc/passwd")).toBe("passwd");
    expect(sanitiseUploadName("bell\u0007\u0000.png")).toBe("bell.png");
    expect(sanitiseUploadName("   ")).toBe("upload");
    expect(sanitiseUploadName("/")).toBe("upload");
    expect(sanitiseUploadName("x".repeat(500))).toHaveLength(120);
  });
});
