import type { AgentConfigPublic, McpServerConfig } from "@mental-lab/shared";
import { getConfigValue, setConfigValue } from "../config.js";
import { getSecretStore } from "../security/crypto.js";

const CONFIG_KEY = "agentConfig";

interface AgentConfigInternal {
  encryptedBraveKey: string | null;
  mcpServers: McpServerConfig[];
}

async function load(): Promise<AgentConfigInternal> {
  const stored = await getConfigValue<AgentConfigInternal>(CONFIG_KEY);
  return stored ?? { encryptedBraveKey: null, mcpServers: [] };
}

export async function getAgentConfig(): Promise<AgentConfigPublic> {
  const c = await load();
  return {
    braveKeySet: c.encryptedBraveKey !== null,
    mcpServers: c.mcpServers,
  };
}

export async function setAgentConfig(patch: {
  braveKey?: string | null;
  mcpServers?: McpServerConfig[];
}): Promise<AgentConfigPublic> {
  const c = await load();
  if (patch.braveKey !== undefined) {
    c.encryptedBraveKey =
      patch.braveKey === null
        ? null
        : getSecretStore().encrypt(patch.braveKey);
  }
  if (patch.mcpServers !== undefined) c.mcpServers = patch.mcpServers;
  await setConfigValue(CONFIG_KEY, c);
  return getAgentConfig();
}

export async function getBraveKey(): Promise<string | null> {
  const c = await load();
  if (!c.encryptedBraveKey) return null;
  return getSecretStore().decrypt(c.encryptedBraveKey);
}

export async function getMcpServers(): Promise<McpServerConfig[]> {
  const c = await load();
  return c.mcpServers;
}
