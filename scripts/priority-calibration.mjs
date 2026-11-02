// Usage: node scripts/priority-calibration.mjs [repo root]
// Calibration check for the priority model (b2a7c3cf): do cost estimates predict
// actual effort? Actual effort = code churn (added + deleted lines outside .bowman)
// of the commits whose subject cites an implemented idea's short id.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.argv[2] ?? ".";
const ideasDir = path.join(root, ".bowman", "ideas");
const log = execFileSync("git", ["-C", root, "log", "--numstat", "--format=@@%s"], { encoding: "utf8", maxBuffer: 1 << 30 });

const commits = [];
for (const line of log.split("\n")) {
  if (line.startsWith("@@")) commits.push({ subject: line.slice(2), churn: 0 });
  const stat = line.match(/^(\d+)\t(\d+)\t(.+)$/);
  if (stat && !stat[3].startsWith(".bowman") && !stat[3].endsWith("lock.yaml")) commits.at(-1).churn += Number(stat[1]) + Number(stat[2]);
}

const rows = [];
for (const file of fs.readdirSync(ideasDir)) {
  const idea = JSON.parse(fs.readFileSync(path.join(ideasDir, file), "utf8"));
  if (idea.status?.state !== "implemented") continue;
  const cited = commits.filter((c) => c.churn > 0 && c.subject.includes(idea.id.slice(0, 8)));
  if (cited.length) rows.push({ cost: idea.cost ?? 1, churn: cited.reduce((sum, c) => sum + c.churn, 0) });
}

const ranks = (values) => {
  const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const result = new Array(values.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j][0] === sorted[i][0]) j++;
    for (let k = i; k < j; k++) result[sorted[k][1]] = (i + j - 1) / 2;
    i = j;
  }
  return result;
};
const spearman = (xs, ys) => {
  const [a, b] = [ranks(xs), ranks(ys)];
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const [ma, mb] = [mean(a), mean(b)];
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : NaN;
};

const estimated = rows.filter((r) => r.cost !== 1);
const rho = (set) => spearman(set.map((r) => r.cost), set.map((r) => r.churn)).toFixed(2);
console.log(`implemented ideas cited by commits with code churn: ${rows.length}, with a non-default cost: ${estimated.length}`);
console.log(`Spearman(cost, churn): all ${rho(rows)}, non-default cost only ${rho(estimated)}`);
if (estimated.length < 30) console.log("Too few estimated ideas to calibrate (< 30); rerun as estimates accumulate.");
