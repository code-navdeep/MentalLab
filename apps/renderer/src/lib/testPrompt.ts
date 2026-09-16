import type { IpcResponse, Tier } from "@mental-lab/shared";

export interface TestPromptCallbacks {
  onDelta: (delta: string) => void;
  onDone: (result: IpcResponse<"models:testPrompt">) => void;
}

export async function runTestPrompt(
  tier: Tier,
  prompt: string,
  callbacks: TestPromptCallbacks
): Promise<void> {
  const requestId = crypto.randomUUID();

  const offDelta = window.ipc.on("stream:delta", (payload) => {
    if (payload.requestId === requestId) callbacks.onDelta(payload.delta);
  });

  const cleanup = () => {
    offDelta();
    offDone();
  };

  const offDone = window.ipc.on("stream:done", (payload) => {
    if (payload.requestId !== requestId) return;
    cleanup();
  });

  const result = await window.ipc.invoke("models:testPrompt", {
    requestId,
    tier,
    prompt,
  });
  cleanup();
  callbacks.onDone(result);
}
