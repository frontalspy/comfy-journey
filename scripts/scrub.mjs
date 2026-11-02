// Fails when a tracked file mentions something that belongs to a private deployment.
// Run in CI so the public repository stays generic: `node scripts/scrub.mjs`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  [/\bd&d\b|\bdnd\b|dungeons/i, "game-platform wording"],
  [/codex|threadbound|reconeia|luminari/i, "private product names"],
  [/cloudflare access|cloudflared|cf-access/i, "private deployment provider"],
  [/autonomous illusions|image[- ]studio/i, "the original app's name"],
  [
    /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/,
    "private network address",
    /\.test\.ts$/,
  ],
  [/[\w.+-]+@(?!example\.)[\w-]+\.(?:com|net|org|io)\b/i, "email address"],
];
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
console.log(`Scrub clean (${files.length} files).`);
