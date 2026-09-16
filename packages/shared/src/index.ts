export * from "./ipc.js";
export * from "./models.js";
export * from "./library.js";
export * from "./reader.js";
export * from "./agent.js";
export * from "./vault.js";

export const APP_MODES = ["chat", "reader", "tasks", "vault", "settings"] as const;
export type AppMode = (typeof APP_MODES)[number];

export const APP_NAME = "Mental Lab";
