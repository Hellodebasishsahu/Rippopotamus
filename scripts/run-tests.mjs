import { spawnSync } from "node:child_process";
import path from "node:path";

const nodeTests = [
  "tests/electron_cookie_validation.test.cjs",
  "tests/electron_thumbnail_validation.test.cjs",
  "tests/electron_page_probe_policy_validation.test.cjs",
  "tests/url_parser_validation.test.cjs",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolvePythonCommand() {
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    const args = command === "py" ? ["-3", "--version"] : ["--version"];
    const result = spawnSync(command, args, {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.status === 0) {
      return command === "py" ? { command, args: ["-3"] } : { command, args: [] };
    }
  }
  console.error("No usable Python runtime found. Install Python 3.11+ and retry.");
  process.exit(1);
}

const pythonEnv = {
  ...process.env,
  PYTHONPATH: ["src", process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
};

const python = resolvePythonCommand();
run(python.command, [...python.args, "-m", "unittest", "discover", "-s", "tests"], { env: pythonEnv });
run("npm", ["run", "build:desktop"]);
run("node", ["--test", ...nodeTests]);
