import { contextBridge, ipcRenderer } from "electron";
import {
  validateRequest,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type IpcApi,
  type IpcRequest,
  type IpcResponse,
} from "@mental-lab/shared/ipc";

const ipc: IpcApi = {
  invoke<K extends InvokeChannel>(
    channel: K,
    args: IpcRequest<K>
  ): Promise<IpcResponse<K>> {
    const validated = validateRequest(channel, args);
    return ipcRenderer.invoke(channel, validated);
  },

  on<K extends EventChannel>(
    channel: K,
    handler: (payload: EventPayload<K>) => void
  ): () => void {
    const listener = (_event: unknown, payload: EventPayload<K>) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld("ipc", ipc);
