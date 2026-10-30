import { initializeSandbox } from "./sandbox.js";
import { configureSkills, loadSkills } from "./skills.js";
import { cleanupOrphanedTasks } from "./director.js";
import { startAutomations } from "./automations.js";

export {
  closeAgentConnections,
  configureAgentEvents,
  deleteTask,
  getPendingRequest,
  getTask,
  listTasks,
  respondToRequest,
  runTask,
} from "./director.js";
export {
  deleteAutomation,
  listAutomations,
  runAutomationNow,
  saveAutomation,
  stopAutomations,
} from "./automations.js";
export { killRunningCommands } from "./tools.js";
export {
  getSandboxConfig,
  isSandboxSupported,
  shutdownSandbox,
  updateSandboxConfig,
} from "./sandbox.js";
export { getAgentConfig, setAgentConfig } from "./agent-config.js";

/** Boot the agent subsystem. Call once after the DB is up. */
export async function startAgent(opts: {
  dataDir: string;
  skillsDir: string;
}): Promise<void> {
  await initializeSandbox(opts.dataDir);
  configureSkills(opts.skillsDir);
  await loadSkills();
  await cleanupOrphanedTasks();
  await startAutomations();
}
