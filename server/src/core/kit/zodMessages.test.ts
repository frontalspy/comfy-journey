import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodIssues, zodErrorMessage, zodIssueMessages } from "./zodMessages.js";

function errorOf(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected failure");
  return result.error;
}

describe("zod message helpers", () => {
  const nested = z.object({ data: z.object({ level: z.number() }), name: z.string() });

  it("zodErrorMessage reports the first issue with its path", () => {
    expect(zodErrorMessage(errorOf(nested, { data: {} }))).toBe("data.level: Required");
  });

  it("zodErrorMessage omits the path for a root-level issue", () => {
    expect(zodErrorMessage(errorOf(z.string(), 1))).toBe("Expected string, received number");
  });

  it("zodErrorMessage falls back when there are no issues", () => {
    expect(zodErrorMessage(new z.ZodError([]))).toBe("Invalid request body.");
  });

  it("zodIssueMessages lists every issue", () => {
    expect(zodIssueMessages(errorOf(nested, {}))).toEqual(["data: Required", "name: Required"]);
  });

  it("formatZodIssues prefixes each issue, including root-level ones", () => {
    expect(formatZodIssues("monsters[2]", errorOf(nested, { data: {}, name: "x" }))).toEqual([
      "monsters[2].data.level: Required",
    ]);
    expect(formatZodIssues("book.json", errorOf(z.string(), 1))).toEqual([
      "book.json: Expected string, received number",
    ]);
  });
});
