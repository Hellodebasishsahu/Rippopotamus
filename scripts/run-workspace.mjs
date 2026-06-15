#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspaces = {
  "@rippopotamus/website": "apps/website",
  "@rippopotamus/desktop": "apps/desktop",
};

const argv = process.argv.slice(2);
const dashIndex = argv.indexOf("--");
const scriptArgv = dashIndex === -1 ? argv : argv.slice(0, dashIndex);
const extraArgs = dashIndex === -1 ? [] : argv.slice(dashIndex + 1);

const [workspaceName, scriptName] = scriptArgv;

if (!workspaceName || !scriptName) {
  console.error("Usage: node scripts/run-workspace.mjs <workspace> <script> [-- <args...>]");
  process.exit(1);
}

const relDir = workspaces[workspaceName];
if (!relDir) {
  console.error(`Unknown workspace: ${workspaceName}`);
  process.exit(1);
}

const workspaceDir = path.join(rootDir, relDir);
const pkgPath = path.join(workspaceDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const script = pkg.scripts?.[scriptName];

if (!script) {
  console.error(`Missing script "${scriptName}" in ${workspaceName}`);
  process.exit(1);
}

const command =
  extraArgs.length > 0
    ? `${script} ${extraArgs.map((arg) => JSON.stringify(arg)).join(" ")}`
    : script;

const result = spawnSync(command, {
  cwd: workspaceDir,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
