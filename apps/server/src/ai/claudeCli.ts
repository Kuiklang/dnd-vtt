import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HttpError } from "../lib/errors.js";

/**
 * Runs the Claude Code CLI that is installed and signed in on the computer running this
 * server (`claude -p`), so AI features use that person's Claude plan instead of a paid
 * API key. Arguments are passed as an array (no shell); the prompt goes on stdin.
 */
export interface ClaudeCliOptions {
  /** Path to the `claude` command (default: found on PATH). */
  command: string;
  /** Optional model; empty = whatever the signed-in plan uses by default. */
  model?: string;
  timeoutMs?: number;
}

export interface ClaudeCliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
}

const unavailable = (why: string) => new HttpError(503, "ai_unavailable", why);

/** Maps a failed run's text to a friendly error. */
export function cliError(text: string): HttpError {
  if (/log ?in|logged in|auth|credential|api key|401/i.test(text))
    return unavailable("Claude Code on the server computer isn't signed in. Run `claude` once there and log in.");
  if (/rate|limit|usage|quota|429/i.test(text)) return new HttpError(429, "rate_limited", "Your Claude plan's usage limit was reached. Try again later.");
  return new HttpError(502, "ai_failed", "Claude Code couldn't answer. Please try again.");
}

/**
 * On Windows, `claude` may be `claude.exe` (native installer) or an npm `claude.cmd` shim.
 * Node can't start a .cmd without a shell, and a shell would re-parse our arguments, so for
 * the shim we run the package's own entry file directly. Elsewhere the command is used as is.
 */
export function resolveClaudeCommand(command: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { file: string; prefixArgs: string[] } {
  if (platform !== "win32") return { file: command, prefixArgs: [] };
  const hasDir = /[\\/]/.test(command);
  const dirs = hasDir ? [""] : (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  const exts = path.extname(command) ? [""] : [".exe", ".cmd"];
  for (const ext of exts)
    for (const dir of dirs) {
      const file = dir ? path.join(dir, command + ext) : command + ext;
      if (!existsSync(file)) continue;
      if (!file.toLowerCase().endsWith(".cmd")) return { file, prefixArgs: [] };
      const pkgDir = path.join(path.dirname(file), "node_modules", "@anthropic-ai", "claude-code");
      try {
        const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.claude;
        if (bin) {
          const target = path.join(pkgDir, bin);
          return /\.(c|m)?js$/i.test(target) ? { file: process.execPath, prefixArgs: [target] } : { file: target, prefixArgs: [] };
        }
      } catch {
        /* not the npm package layout; fall through */
      }
    }
  return { file: command, prefixArgs: [] };
}

const resolved = new Map<string, { file: string; prefixArgs: string[] }>();

export function runClaudeCli(opts: ClaudeCliOptions, args: string[], cwd: string, prompt: string): Promise<ClaudeCliResult> {
  const fullArgs = ["-p", "--output-format", "json", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", ...args, ...(opts.model ? ["--model", opts.model] : [])];
  return new Promise<string>((resolve, reject) => {
    let cmd = resolved.get(opts.command);
    if (!cmd) resolved.set(opts.command, (cmd = resolveClaudeCommand(opts.command)));
    const child = spawn(cmd.file, [...cmd.prefixArgs, ...fullArgs], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new HttpError(504, "ai_timeout", "Claude took too long to answer. Try again with a shorter request."));
    }, opts.timeoutMs ?? 5 * 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? unavailable("Claude Code isn't installed on the computer running the server (or CLAUDE_CODE_PATH is wrong).") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A failed run still prints its JSON result (is_error), which explains more than the exit code.
      if (stdout.trim()) resolve(stdout);
      else reject(cliError(stderr || `exit code ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  }).then(parseCliOutput);
}

/** Parses `--output-format json` output (the last JSON line), throwing on is_error. */
export function parseCliOutput(stdout: string): ClaudeCliResult {
  let res: ClaudeCliResult;
  try {
    const line = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
    res = JSON.parse(line ?? stdout);
  } catch {
    throw new HttpError(502, "ai_failed", "Claude Code returned something unexpected. Please try again.");
  }
  if (res.is_error) throw cliError(`${res.subtype ?? ""} ${res.result ?? ""}`);
  return res;
}
