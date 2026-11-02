import type { z } from "zod";

/** One issue as `path.to.field: message`, or just the message when the issue is at the root. */
function describeIssue(issue: z.ZodIssue, prefix?: string): string {
  const path = issue.path.join(".");
  const location = prefix ? (path ? `${prefix}.${path}` : prefix) : path;
  return location ? `${location}: ${issue.message}` : issue.message;
}

/**
 * One human-readable string, never the raw zod error object — a serialized validation object
 * reaching the client is exactly the ShareDialog bug docs/archive/OVERHAUL.md §0.5's convention exists to
 * prevent. This is the `error` field of a validation 400.
 */
export function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body.";
  return describeIssue(issue);
}

/** Every issue as its own readable string — the `issues` field of a validation 400. */
export function zodIssueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => describeIssue(issue));
}

/**
 * Every issue as `<prefix>.path.to.field: message`. Reports every problem at once, each located by
 * where in the input it came from.
 */
export function formatZodIssues(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => describeIssue(issue, prefix));
}
