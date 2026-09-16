import type { IpcApi } from "@mental-lab/shared";

declare global {
  interface Window {
    ipc: IpcApi;
  }
}

export {};
