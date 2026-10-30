/**
 * Agent tools (actors) built on the AI SDK tool-calling interface.
 * Safety model: sandboxed shell commands and writes
 * to allowed paths run without confirmation; everything else asks the user.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tool, type Tool } from "ai";
import { minimatch } from "minimatch";
import { z } from "zod";
import { getBraveKey } from "./agent-config.js";
import {
  annotateStderrWithSandboxFailures,
  expandPath,
  getSandboxEnvOverrides,
  isPathDeniedForRead,
  isPathWithinAllowedWrite,
  isSandboxActive,
  wrapCommandWithSandbox,
} from "./sandbox.js";

export interface TaskContext {
  requestUser(req: {
    kind: "confirm" | "ask";
    title: string;
    description: string | null;
    command: string | null;
    options: string[];
    textInput: boolean;
  }): Promise<{ approved: boolean; response: string | null }>;
}

const MAX_TOOL_OUTPUT_CHARS = 100_000;

export function truncateOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_TOOL_OUTPUT_CHARS) +
    `\n\n[Output truncated: showing first ${MAX_TOOL_OUTPUT_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters]`
  );
}

function resolveUserPath(p: string): string {
  const expanded = expandPath(p);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(os.homedir(), expanded);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function viewFileTool(ctx: TaskContext): Tool {
  return tool({
    description:
      "View the contents of a text file. Use offset and limit to efficiently read large files.",
    inputSchema: z.object({
      path: z.string().describe("File path (absolute or relative to home)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Starting line offset (0-based). Default 0."),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of lines to read. Default 200."),
    }),
    execute: async (args) => {
      const filePath = resolveUserPath(args.path);
      if (isPathDeniedForRead(filePath)) {
        const ok = await ctx.requestUser({
          kind: "confirm",
          title: "Read a protected file?",
          description: `The agent wants to read ${filePath}, which is on the protected list.`,
          command: null,
          options: [],
          textInput: false,
        });
        if (!ok.approved) return "Read cancelled: the user denied access.";
      }
      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const offset = args.offset ?? 0;
        const limit = args.limit ?? 200;
        const slice = lines.slice(offset, offset + limit);
        const numbered = slice
          .map((l, i) => `${offset + i + 1}\t${l}`)
          .join("\n");
        const suffix =
          offset + limit < lines.length
            ? `\n\n[${lines.length - offset - limit} more lines — use offset/limit to read further]`
            : "";
        return truncateOutput(numbered + suffix);
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function listFilesTool(): Tool {
  return tool({
    description:
      "List files under a path, sorted by modification time (newest first). Supports glob pattern filtering.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Directory to list (absolute or relative to home). Default home."),
      pattern: z
        .string()
        .optional()
        .describe("Optional glob to filter files (e.g. '*.md')"),
      ignore: z
        .array(z.string())
        .optional()
        .describe("Glob patterns to exclude (e.g. ['node_modules'])"),
    }),
    execute: async (args) => {
      const dir = resolveUserPath(args.path ?? "~");
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const rows: { name: string; mtime: number; isDir: boolean }[] = [];
        for (const entry of entries) {
          if (
            args.ignore?.some((g) => minimatch(entry.name, g, { dot: true }))
          ) {
            continue;
          }
          if (
            args.pattern &&
            !entry.isDirectory() &&
            !minimatch(entry.name, args.pattern, { dot: true })
          ) {
            continue;
          }
          try {
            const s = await stat(path.join(dir, entry.name));
            rows.push({
              name: entry.name,
              mtime: s.mtimeMs,
              isDir: entry.isDirectory(),
            });
          } catch {
            rows.push({ name: entry.name, mtime: 0, isDir: entry.isDirectory() });
          }
        }
        rows.sort((a, b) => b.mtime - a.mtime);
        if (rows.length === 0) return "(empty)";
        return truncateOutput(
          rows
            .map(
              (r) =>
                `${r.isDir ? "dir " : "file"}  ${new Date(r.mtime).toISOString().slice(0, 16)}  ${r.name}`
            )
            .join("\n")
        );
      } catch (err) {
        return `Error listing files: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

async function* walkFiles(
  dir: string,
  include: string | undefined,
  depth: number
): AsyncGenerator<string> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, include, depth + 1);
    } else if (!include || minimatch(entry.name, include, { dot: true })) {
      yield full;
    }
  }
}

function grepFilesTool(): Tool {
  return tool({
    description:
      "Line-oriented regex search through files under a path. Returns matching lines with optional context.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex to search for (single-line matches)"),
      path: z
        .string()
        .optional()
        .describe("Directory or file to search. Default home directory."),
      include: z
        .string()
        .optional()
        .describe("Glob filter for files to search (e.g. '*.ts')"),
      lines_before: z.number().int().min(0).max(20).optional(),
      lines_after: z.number().int().min(0).max(20).optional(),
      max_results: z.number().int().min(1).max(5000).optional(),
    }),
    execute: async (args) => {
      const root = resolveUserPath(args.path ?? "~");
      let re: RegExp;
      try {
        re = new RegExp(args.pattern);
      } catch (err) {
        return `Invalid regex: ${err instanceof Error ? err.message : String(err)}`;
      }
      const maxResults = args.max_results ?? 500;
      const before = args.lines_before ?? 0;
      const after = args.lines_after ?? 0;
      const out: string[] = [];

      const searchOne = async (filePath: string) => {
        let content: string;
        try {
          content = await readFile(filePath, "utf-8");
        } catch {
          return;
        }
        if (content.includes(String.fromCharCode(0))) return; // skip binary files
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (out.length >= maxResults) return;
          if (re.test(lines[i]!)) {
            const start = Math.max(0, i - before);
            const end = Math.min(lines.length - 1, i + after);
            for (let j = start; j <= end; j++) {
              out.push(`${filePath}:${j + 1}:${lines[j]}`);
            }
          }
        }
      };

      try {
        const rootStat = await stat(root);
        if (rootStat.isFile()) {
          await searchOne(root);
        } else {
          for await (const file of walkFiles(root, args.include, 0)) {
            if (out.length >= maxResults) break;
            await searchOne(file);
          }
        }
      } catch (err) {
        return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (out.length === 0) return "No matches found.";
      return truncateOutput(out.slice(0, maxResults).join("\n"));
    },
  });
}

async function gateWrite(
  ctx: TaskContext,
  filePath: string,
  what: string
): Promise<string | null> {
  if (isPathWithinAllowedWrite(filePath)) return null;
  const ok = await ctx.requestUser({
    kind: "confirm",
    title: `Allow the agent to ${what}?`,
    description: `Target: ${filePath}\nThis path is outside the sandbox write allowlist.`,
    command: null,
    options: [],
    textInput: false,
  });
  return ok.approved ? null : "Cancelled: the user denied the write.";
}

function writeFileTool(ctx: TaskContext): Tool {
  return tool({
    description:
      "Create a new file or overwrite an existing file with the given content. Creates parent directories if needed.",
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path of the file to write"),
      content: z.string(),
    }),
    execute: async (args) => {
      const filePath = resolveUserPath(args.file_path);
      const denial = await gateWrite(ctx, filePath, `write ${path.basename(filePath)}`);
      if (denial) return denial;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, args.content, "utf-8");
        return `Wrote ${args.content.length} characters to ${filePath}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function editFileTool(ctx: TaskContext): Tool {
  return tool({
    description:
      "Edit a file with an exact string replacement. old_string must be unique in the file unless replace_all is true. Read the file first.",
    inputSchema: z.object({
      file_path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
    execute: async (args) => {
      const filePath = resolveUserPath(args.file_path);
      const denial = await gateWrite(ctx, filePath, `edit ${path.basename(filePath)}`);
      if (denial) return denial;
      try {
        const content = await readFile(filePath, "utf-8");
        const occurrences = content.split(args.old_string).length - 1;
        if (occurrences === 0) {
          return "Error: old_string not found in the file.";
        }
        if (occurrences > 1 && !args.replace_all) {
          return `Error: old_string occurs ${occurrences} times; provide more context or set replace_all.`;
        }
        const updated = args.replace_all
          ? content.split(args.old_string).join(args.new_string)
          : content.replace(args.old_string, args.new_string);
        await writeFile(filePath, updated, "utf-8");
        return `Edited ${filePath} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).`;
      } catch (err) {
        return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

// Shell commands still running, so app quit can stop them.
const runningCommands = new Set<ChildProcess>();

/** Quit, step 2: kill every agent shell command still running. */
export function killRunningCommands(): void {
  for (const child of runningCommands) child.kill("SIGKILL");
  runningCommands.clear();
}

function shellCommandTool(ctx: TaskContext): Tool {
  return tool({
    description:
      "Execute a bash command on the user's Mac. Sandbox mode (default) runs without confirmation but with restricted writes (/tmp, app data) and limited network domains. Direct mode has full access but requires user approval.",
    inputSchema: z.object({
      justification: z
        .string()
        .describe("Why this command needs to run; shown to the user on approval"),
      command: z.string().describe("The bash command to execute"),
      execution_mode: z
        .enum(["sandbox", "direct"])
        .optional()
        .describe("sandbox (default, no confirmation) or direct (asks the user)"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (absolute or relative to home)"),
      timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional(),
    }),
    execute: async (args) => {
      if (!args.command.trim()) return "Error: command is empty";
      const workingDir = resolveUserPath(args.cwd ?? "~");
      try {
        const s = await stat(workingDir);
        if (!s.isDirectory()) return `Error: not a directory: ${workingDir}`;
      } catch {
        return `Error: working directory does not exist: ${workingDir}`;
      }

      const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const sandboxAvailable = isSandboxActive();
      const useSandbox =
        args.execution_mode === "direct" ? false : sandboxAvailable;

      if (!useSandbox) {
        const ok = await ctx.requestUser({
          kind: "confirm",
          title: "Run this command with full access?",
          description: args.justification,
          command: args.command,
          options: [],
          textInput: false,
        });
        if (!ok.approved) {
          return `Command cancelled: ${ok.response ?? "the user denied it"}`;
        }
      }

      const finalCommand = useSandbox
        ? await wrapCommandWithSandbox(args.command)
        : args.command;
      const env = useSandbox
        ? { ...process.env, ...getSandboxEnvOverrides() }
        : process.env;

      return new Promise<string>((resolve) => {
        const child = spawn("/bin/bash", ["-c", finalCommand], {
          cwd: workingDir,
          env,
        });
        runningCommands.add(child);
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeout);

        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code) => {
          clearTimeout(timer);
          runningCommands.delete(child);
          if (timedOut) {
            resolve(`Command timed out after ${timeout}ms: ${args.command}`);
            return;
          }
          stdout = stdout.trim();
          stderr = stderr.trim();
          if (useSandbox && stderr) {
            stderr = stderr
              .split("\n")
              .filter(
                (l) =>
                  !l.includes("error: couldn't create cache file") &&
                  !l.includes("xcrun_db")
              )
              .join("\n")
              .trim();
            stderr = annotateStderrWithSandboxFailures(args.command, stderr);
          }
          let output = stdout;
          if (stderr) output += (output ? "\n\n" : "") + `[stderr]\n${stderr}`;
          if (!output) output = "(no output)";
          if (code !== 0) output += `\n\n[Exit code: ${code}]`;
          if (
            useSandbox &&
            code !== 0 &&
            (stderr.includes("Operation not permitted") ||
              stderr.includes("Permission denied"))
          ) {
            output +=
              "\n\n[Possible sandbox violation: writes are limited to /tmp and the app data folder in sandbox mode. Use execution_mode: \"direct\" for full access (asks the user).]";
          }
          resolve(truncateOutput(output));
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          runningCommands.delete(child);
          resolve(`Error executing command: ${err.message}`);
        });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function readWebpageTool(): Tool {
  return tool({
    description:
      "Read and extract the text content of a webpage URL. Use after search_web or when given a specific URL.",
    inputSchema: z.object({
      url: z.string().describe("URL starting with http:// or https://"),
    }),
    execute: async (args) => {
      if (!/^https?:\/\//.test(args.url)) {
        return "Error: URL must start with http:// or https://";
      }
      try {
        const res = await fetch(args.url, {
          signal: AbortSignal.timeout(20_000),
          headers: { "User-Agent": "MentalLab/1.0.0 (personal research app)" },
        });
        if (!res.ok) return `Error: HTTP ${res.status} fetching ${args.url}`;
        const html = await res.text();
        const text = stripHtml(html);
        return text.length > 20_000
          ? text.slice(0, 20_000) + "\n\n[Content truncated at 20,000 characters]"
          : text || "(page had no extractable text)";
      } catch (err) {
        return `Error fetching page: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function searchWebTool(braveKey: string): Tool {
  return tool({
    description:
      "Search the web for current information. Returns result titles, links and snippets.",
    inputSchema: z.object({
      query: z.string(),
      max_results: z.number().int().min(1).max(20).optional(),
    }),
    execute: async (args) => {
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", args.query);
        url.searchParams.set("count", String(args.max_results ?? 10));
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": braveKey,
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return `Search failed: HTTP ${res.status}`;
        const data = (await res.json()) as {
          web?: { results?: { title: string; url: string; description: string }[] };
        };
        const results = data.web?.results ?? [];
        if (results.length === 0) return "No results found.";
        return results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${stripHtml(r.description ?? "")}`)
          .join("\n\n");
      } catch (err) {
        return `Search error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Ask the user
// ---------------------------------------------------------------------------

function askUserTool(ctx: TaskContext): Tool {
  return tool({
    description:
      "Ask the user a question mid-task. Use for clarifying ambiguous instructions, choosing between approaches, or getting a decision. Offer 2-4 concise options when the answer is a choice.",
    inputSchema: z.object({
      title: z.string().describe("Short, specific question heading"),
      description: z
        .string()
        .optional()
        .describe("Context, trade-offs or implications"),
      options: z
        .array(z.string())
        .optional()
        .describe("Choice labels (2-4). Omit for free-text answers."),
      input_type: z.enum(["choice", "text_input"]).optional(),
    }),
    execute: async (args) => {
      const result = await ctx.requestUser({
        kind: "ask",
        title: args.title,
        description: args.description ?? null,
        command: null,
        options: args.options ?? [],
        textInput: args.input_type === "text_input" || !(args.options?.length),
      });
      if (!result.approved) return "The user dismissed the question.";
      return `User answered: ${result.response ?? "(acknowledged)"}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export async function buildTools(ctx: TaskContext): Promise<Record<string, Tool>> {
  const tools: Record<string, Tool> = {
    view_file: viewFileTool(ctx),
    list_files: listFilesTool(),
    grep_files: grepFilesTool(),
    write_file: writeFileTool(ctx),
    edit_file: editFileTool(ctx),
    shell_command: shellCommandTool(ctx),
    read_webpage: readWebpageTool(),
    ask_user: askUserTool(ctx),
  };
  const braveKey = await getBraveKey();
  if (braveKey) {
    tools.search_web = searchWebTool(braveKey);
  }
  return tools;
}
