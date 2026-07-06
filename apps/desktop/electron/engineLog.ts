import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// Persist a rolling log of every engine invocation so failures (slow fetches,
// extractor errors, thumbnail misses) are observable after the fact instead of
// vanishing with the child process. One file, size-capped, no external deps.

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_STDERR_CHARS = 4000;

function logDir(): string {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function engineLogPath(): string {
  return path.join(logDir(), "engine.log");
}

function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch {
    // No file yet, or rename raced — either way nothing to rotate.
  }
}

function timestamp(): string {
  // Date.now()/new Date() are fine in the main process (unlike workflow scripts).
  return new Date().toISOString();
}

function append(line: string): void {
  try {
    const file = engineLogPath();
    rotateIfNeeded(file);
    fs.appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`);
  } catch {
    // Logging must never take down a download.
  }
}

// Redact the obvious secrets that can appear in engine args/cookies.
function redact(text: string): string {
  return text
    .replace(/(--cookies(?:-from-browser)?[ =])[^\s]+/gi, "$1<redacted>")
    .replace(/([?&](?:token|sig|signature|key|password|pwd)=)[^\s&]+/gi, "$1<redacted>");
}

export function logEngineStart(id: string, command: string, args: string[]): void {
  append(`${timestamp()} [${id}] START ${command} ${redact(args.join(" "))}`);
}

export function logEngineEnd(id: string, code: number | null, ms: number, stderr: string): void {
  const tail = redact(stderr.trim()).slice(-MAX_STDERR_CHARS);
  append(`${timestamp()} [${id}] END code=${code ?? "null"} ${ms}ms${tail ? `\n  stderr: ${tail.replace(/\n/g, "\n  ")}` : ""}`);
}
