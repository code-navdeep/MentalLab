/**
 * Sandbox for agent shell commands.
 * Uses @anthropic-ai/sandbox-runtime: Apple Seatbelt on macOS, bwrap on
 * Linux. Sandboxed commands skip user confirmation; direct commands gate on
 * explicit approval.
 */
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { getConfigValue, setConfigValue } from "../config.js";

export const SANDBOX_TEMP_DIR = "/tmp/mentallab";
const CONFIG_KEY = "sandboxSettings";

export interface SandboxConfig {
  enabled: boolean;
  allowedWritePaths: string[];
  deniedWritePaths: string[];
  deniedReadPaths: string[];
  allowedDomains: string[];
  allowLocalBinding: boolean;
}

export function expandPath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function expandPaths(paths: string[]): string[] {
  return paths.map(expandPath);
}

function getMacOSUserTempDir(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const tempDir = execSync('realpath "$(getconf DARWIN_USER_TEMP_DIR)"', {
      encoding: "utf-8",
    }).trim();
    return tempDir || null;
  } catch {
    return null;
  }
}

const DEFAULT_DENIED_READ_PATHS: string[] = [
  "**/.ssh",
  "**/.gnupg",
  "**/.gpg",
  "~/.ssh",
  "~/.gnupg",
  "~/.gpg",
  "**/.aws",
  "**/.azure",
  "**/.gcloud",
  "~/.aws",
  "~/.azure",
  "~/.gcloud",
  "~/.config/gcloud",
  ".npmrc",
  ".yarnrc",
  ".pypirc",
  ".netrc",
  "~/.docker/config.json",
  "**/.password-store",
  "~/.local/share/keyrings",
  ".bash_history",
  ".zsh_history",
  ".history",
  ".env",
  "/etc",
  "/var/log",
  "/private/etc",
  "/private/var/log",
];

const DEFAULT_ALLOWED_DOMAINS: string[] = [
  "npmjs.org",
  "*.npmjs.org",
  "registry.npmjs.org",
  "pypi.org",
  "*.pypi.org",
  "files.pythonhosted.org",
  "rubygems.org",
  "crates.io",
  "github.com",
  "*.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "*.githubusercontent.com",
  "api.anthropic.com",
  "api.openai.com",
  "api.deepseek.com",
  "localhost",
];

let appDataDir: string | null = null;

function defaultConfig(): SandboxConfig {
  const writePaths = ["/tmp", "/private/tmp", SANDBOX_TEMP_DIR];
  if (appDataDir) writePaths.push(appDataDir);
  const macTemp = getMacOSUserTempDir();
  if (macTemp) writePaths.push(macTemp);
  return {
    enabled: true,
    allowedWritePaths: writePaths,
    deniedWritePaths: [],
    deniedReadPaths: DEFAULT_DENIED_READ_PATHS,
    allowedDomains: DEFAULT_ALLOWED_DOMAINS,
    allowLocalBinding: true,
  };
}

function buildRuntimeConfig(config: SandboxConfig): SandboxRuntimeConfig {
  return {
    filesystem: {
      denyRead: expandPaths(config.deniedReadPaths),
      allowWrite: expandPaths(config.allowedWritePaths),
      denyWrite: expandPaths(config.deniedWritePaths),
      allowGitConfig: true,
    },
    network: {
      allowedDomains: config.allowedDomains,
      allowMachLookup: ["com.apple.metadata.mds"],
      deniedDomains: [],
      allowLocalBinding: config.allowLocalBinding,
      allowAllUnixSockets: true,
    },
  };
}

let currentConfig: SandboxConfig | null = null;
let initialized = false;

export async function initializeSandbox(dataDir: string): Promise<void> {
  appDataDir = dataDir;
  try {
    const stored = await getConfigValue<SandboxConfig>(CONFIG_KEY);
    currentConfig = stored ?? defaultConfig();
    if (!stored) await setConfigValue(CONFIG_KEY, currentConfig);

    if (!SandboxManager.isSupportedPlatform() || !currentConfig.enabled) {
      initialized = true;
      return;
    }

    process.env.CLAUDE_TMPDIR = SANDBOX_TEMP_DIR;
    await SandboxManager.initialize(buildRuntimeConfig(currentConfig));
    SandboxManager.checkDependencies();
    initialized = true;
  } catch {
    // Never block app startup on sandbox problems; direct mode still gates
    // on user confirmation.
    initialized = true;
  }
}

export function isSandboxActive(): boolean {
  return (
    initialized &&
    currentConfig !== null &&
    currentConfig.enabled &&
    SandboxManager.isSupportedPlatform()
  );
}

export function isSandboxSupported(): boolean {
  return SandboxManager.isSupportedPlatform();
}

/** Quit, step 6: release the sandbox (its network proxies). */
export async function shutdownSandbox(): Promise<void> {
  if (!isSandboxActive()) return;
  await SandboxManager.reset();
}

export function getSandboxConfig(): SandboxConfig {
  return { ...(currentConfig ?? defaultConfig()) };
}

export async function updateSandboxConfig(
  patch: Partial<SandboxConfig>
): Promise<SandboxConfig> {
  const next = { ...(currentConfig ?? defaultConfig()), ...patch };
  currentConfig = next;
  await setConfigValue(CONFIG_KEY, next);
  if (next.enabled && SandboxManager.isSupportedPlatform()) {
    SandboxManager.updateConfig(buildRuntimeConfig(next));
  }
  return next;
}

export async function wrapCommandWithSandbox(command: string): Promise<string> {
  if (!isSandboxActive() || !currentConfig) return command;
  try {
    const wrapped = await SandboxManager.wrapWithSandbox(
      command,
      "/bin/bash",
      buildRuntimeConfig(currentConfig)
    );
    // shell-quote escapes ! for interactive bash; non-interactive bash would
    // keep the backslash literally, breaking e.g. Python's !=.
    return wrapped.replace(/\\!/g, "!");
  } catch {
    return command;
  }
}

export function annotateStderrWithSandboxFailures(
  command: string,
  stderr: string
): string {
  if (!isSandboxActive()) return stderr;
  try {
    return SandboxManager.annotateStderrWithSandboxFailures(command, stderr);
  } catch {
    return stderr;
  }
}

function isPathWithinDirectory(testPath: string, directory: string): boolean {
  const dirWithSep = directory.endsWith(path.sep)
    ? directory
    : directory + path.sep;
  return testPath === directory || testPath.startsWith(dirWithSep);
}

/** Writes inside these paths skip user confirmation. */
export function isPathWithinAllowedWrite(absolutePath: string): boolean {
  const config = currentConfig ?? defaultConfig();
  const normalized = path.normalize(absolutePath);
  for (const denied of config.deniedWritePaths) {
    if (isPathWithinDirectory(normalized, expandPath(denied))) return false;
  }
  for (const allowed of config.allowedWritePaths) {
    if (isPathWithinDirectory(normalized, expandPath(allowed))) return true;
  }
  return false;
}

/** Reads of these paths require user confirmation (credentials etc.). */
export function isPathDeniedForRead(absolutePath: string): boolean {
  const config = currentConfig ?? defaultConfig();
  const normalized = path.normalize(absolutePath);
  for (const denied of config.deniedReadPaths) {
    if (denied.startsWith("**/")) {
      const dirName = denied.slice(3);
      if (
        normalized.includes(`/${dirName}/`) ||
        normalized.endsWith(`/${dirName}`)
      ) {
        return true;
      }
      continue;
    }
    if (denied.startsWith("/") || denied.startsWith("~")) {
      if (isPathWithinDirectory(normalized, expandPath(denied))) return true;
      continue;
    }
    const basename = path.basename(normalized);
    if (basename === denied) return true;
    if (denied === ".env" && /^\.env(\.[a-zA-Z]+)?$/.test(basename)) return true;
    if (normalized.includes(`/${denied}/`)) return true;
  }
  return false;
}

/** Env overrides that point tool caches at sandbox-writable directories. */
export function getSandboxEnvOverrides(): Record<string, string> {
  return {
    TMPDIR: SANDBOX_TEMP_DIR,
    GIT_CONFIG_NOSYSTEM: "1",
    UV_CACHE_DIR: `${SANDBOX_TEMP_DIR}/uv-cache`,
    UV_TOOL_DIR: `${SANDBOX_TEMP_DIR}/uv-tools`,
    UV_TOOL_BIN_DIR: `${SANDBOX_TEMP_DIR}/uv-tools/bin`,
    UV_PYTHON_INSTALL_DIR: `${SANDBOX_TEMP_DIR}/uv-python`,
    PIP_CACHE_DIR: `${SANDBOX_TEMP_DIR}/pip-cache`,
    npm_config_cache: `${SANDBOX_TEMP_DIR}/npm-cache`,
  };
}
