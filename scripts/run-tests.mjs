import { spawnSync } from "node:child_process";
import path from "node:path";

const nodeTests = [
  "tests/electron_cookie_validation.test.cjs",
  "tests/electron_thumbnail_validation.test.cjs",
  "tests/electron_media_library_validation.test.cjs",
  "tests/electron_page_probe_policy_validation.test.cjs",
  "tests/library_preview_contract.test.cjs",
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

const pythonEnv = {
  ...process.env,
  PYTHONPATH: ["src", process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
};

run("python", ["-m", "unittest", "discover", "-s", "tests"], { env: pythonEnv });
run("npm", ["run", "build"]);
run("node", ["--test", ...nodeTests]);
