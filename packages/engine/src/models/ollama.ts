import type { OllamaStatus } from "@mental-lab/shared";

export async function probeOllama(baseUrl: string): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { running: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return {
      running: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch {
    return { running: false, models: [] };
  }
}
