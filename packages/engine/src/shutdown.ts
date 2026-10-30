import { closeAgentConnections } from "./agent/director.js";
import { stopAutomations } from "./agent/automations.js";
import { shutdownSandbox } from "./agent/sandbox.js";
import { killRunningCommands } from "./agent/tools.js";
import { closeDb } from "./db/index.js";
import { stopEmbeddings } from "./indexer/embeddings.js";
import { stopLibrary, waitForIndex } from "./indexer/library.js";
import { stopAppleSidecar } from "./models/apple.js";
import { stopVault, waitForVaultSync } from "./vault/index.js";

// How long an in-flight index run or vault sync gets to reach its next stop
// point before the helpers are stopped anyway.
const IN_FLIGHT_LIMIT_MS = 2000;

/** One shutdown step; a failure never skips the steps after it. */
async function step(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // keep shutting down
  }
}

/**
 * Stop everything the engine started, in order, before the app exits:
 * no new work → agent tasks → in-flight index and sync → helper processes →
 * sandbox → database.
 */
export async function shutdownEngine(): Promise<void> {
  // 1. No new work: schedules, timers, folder watching.
  await step(stopVault);
  await step(stopAutomations);
  await step(stopLibrary);

  // 2. Agent tasks: shell commands and MCP tool servers.
  await step(killRunningCommands);
  await step(closeAgentConnections);

  // 3. The in-flight index run and vault sync stop at their next file/batch.
  await step(() =>
    Promise.race([
      Promise.all([waitForIndex(), waitForVaultSync()]),
      new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_LIMIT_MS)),
    ])
  );

  // 4–5. Helper processes.
  await step(stopEmbeddings);
  await step(stopAppleSidecar);

  // 6. Sandbox network proxies.
  await step(shutdownSandbox);

  // 7. Database last, once nothing writes to it.
  await step(closeDb);
}
