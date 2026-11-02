// Fails when a tracked file mentions something that belongs to a private deployment.
// Run in CI so the public repository stays generic: `node scripts/scrub.mjs`.
//
// Two kinds of rule:
//   - Generic ones, built in: private network addresses and email addresses.
//   - Private terms (names of your own products, hosts, people). They are NOT listed here, because
//     listing them in a public repository would reveal them. Put one case-insensitive regular
//     expression per line in a git-ignored `.scrub-patterns` file, or in the SCRUB_PATTERNS
//     environment variable (CI: a repository secret). Blank lines and lines starting with // are
//     ignored. Without either, only the generic rules run.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const GENERIC = [
  [
    /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/,
    "private network address",
    /\.test\.ts$/,
  ],
  [/[\w.+-]+@(?!example\.)[\w-]+\.(?:com|net|org|io)\b/i, "email address"],
];

function privatePatterns() {
  const fromFile = existsSync(".scrub-patterns") ? readFileSync(".scrub-patterns", "utf8") : "";
  return `${fromFile}\n${process.env.SCRUB_PATTERNS ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .map((source) => [new RegExp(source, "i"), "private term"]);
}

const FORBIDDEN = [...GENERIC, ...privatePatterns()];
const SELF = "scripts/scrub.mjs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(
    (file) =>
      file && file !== SELF && !/\.(png|jpe?g|webp|ico|lock)$|package-lock\.json$/.test(file),
  );

let failures = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    for (const [pattern, why, exemptFiles] of FORBIDDEN) {
      if (exemptFiles?.test(file)) continue;
      if (pattern.test(line)) {
        console.error(`${file}:${index + 1}: ${why}: ${line.trim().slice(0, 100)}`);
        failures++;
      }
    }
  });
}
if (failures) {
  console.error(`\n${failures} problem(s). Move private details out of the repository.`);
  process.exit(1);
}
const extra = FORBIDDEN.length - GENERIC.length;
console.log(
  `Scrub clean (${files.length} files, ${extra} private term(s) checked${extra ? "" : "; none configured"}).`,
);
