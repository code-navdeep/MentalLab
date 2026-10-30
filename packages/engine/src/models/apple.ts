import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";
import type { AppleStatus } from "@mental-lab/shared";

// JSON-lines protocol with the applekit Swift sidecar:
//   -> {"id":"1","cmd":"probe"}
//   <- {"id":"1","type":"probe","available":true,"reason":null}
//   -> {"id":"2","cmd":"generate","prompt":"...","system":"..."}
//   <- {"id":"2","type":"delta","text":"..."}   (repeated)
//   <- {"id":"2","type":"done","error":null}

interface SidecarMessage {
  id: string;
  type: "probe" | "delta" | "done";
  available?: boolean;
  reason?: string | null;
  text?: string;
  error?: string | null;
  granted?: boolean;
}

type Pending = {
  onDelta?: (text: string) => void;
  resolve: (msg: SidecarMessage) => void;
  reject: (err: Error) => void;
};

let binaryPath: string | null = null;
let child: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
const pending = new Map<string, Pending>();
// Set at app quit: the helper is not restarted.
let stopping = false;

export function setAppleSidecarPath(path: string): void {
  binaryPath = path;
}

function ensureProcess(): ChildProcessWithoutNullStreams | null {
  if (child && child.exitCode === null) return child;
  if (!binaryPath || !existsSync(binaryPath)) return null;

  child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let msg: SidecarMessage;
    try {
      msg = JSON.parse(line) as SidecarMessage;
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "delta") {
      p.onDelta?.(msg.text ?? "");
      return;
    }
    pending.delete(msg.id);
    p.resolve(msg);
  });
  child.on("exit", () => {
    for (const [, p] of pending) {
      p.reject(new Error("Apple Intelligence helper stopped unexpectedly"));
    }
    pending.clear();
  });
  return child;
}

export type { SidecarMessage };

/** Generic request to the applekit sidecar (used by models + calendar). */
export function sidecarRequest(
  cmd: Record<string, unknown>,
  onDelta?: (text: string) => void
): Promise<SidecarMessage> {
  return send(cmd, onDelta);
}

function send(
  cmd: Record<string, unknown>,
  onDelta?: (text: string) => void
): Promise<SidecarMessage> {
  if (stopping) return Promise.reject(new Error("App is shutting down"));
  const proc = ensureProcess();
  if (!proc) {
    return Promise.reject(
      new Error("Apple Intelligence helper is not installed with this build")
    );
  }
  const id = String(nextId++);
  return new Promise<SidecarMessage>((resolve, reject) => {
    pending.set(id, { onDelta, resolve, reject });
    proc.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
  });
}

let cachedStatus: AppleStatus | null = null;

export async function probeApple(): Promise<AppleStatus> {
  if (cachedStatus) return cachedStatus;
  if (!binaryPath || !existsSync(binaryPath)) {
    return {
      available: false,
      reason: "Apple Intelligence helper is not installed with this build",
    };
  }
  try {
    const msg = await send({ cmd: "probe" });
    cachedStatus = {
      available: msg.available ?? false,
      reason: msg.reason ?? null,
    };
    return cachedStatus;
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Quit, step 5: close the helper's input (it exits on EOF), and kill it if
 * it is still running a second later — e.g. stuck on a permission prompt.
 */
export async function stopAppleSidecar(): Promise<void> {
  stopping = true;
  const proc = child;
  child = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), 1000);
  });
  const exited = new Promise<boolean>((resolve) => {
    proc.once("exit", () => resolve(false));
  });
  proc.stdin.end();
  if (await Promise.race([exited, timedOut])) proc.kill("SIGKILL");
  clearTimeout(timer);
}

export async function generateApple(
  prompt: string,
  system: string | null,
  onDelta: (text: string) => void
): Promise<void> {
  const msg = await send({ cmd: "generate", prompt, system }, onDelta);
  if (msg.error) throw new Error(msg.error);
}
