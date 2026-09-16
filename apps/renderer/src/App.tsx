import { useCallback, useEffect, useState } from "react";
import type { AppMode, IpcResponse } from "@mental-lab/shared";
import ModeRail from "./components/ModeRail";
import SettingsMode from "./modes/SettingsMode";
import ChatMode from "./modes/ChatMode";
import ReaderMode from "./modes/ReaderMode";
import TasksMode from "./modes/TasksMode";
import VaultMode from "./modes/VaultMode";

export interface ReaderTarget {
  paperId: number;
  page: number | null;
  nonce: number;
}

export interface TaskTarget {
  taskId: number;
  nonce: number;
}

export type ThemePreference = "system" | "light" | "dark";

export function applyTheme(pref: ThemePreference): void {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = pref;
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("chat");
  const [status, setStatus] = useState<IpcResponse<"app:getStatus"> | null>(
    null
  );

  useEffect(() => {
    const stored = localStorage.getItem("theme") as ThemePreference | null;
    if (stored) applyTheme(stored);
  }, []);
  const [readerTarget, setReaderTarget] = useState<ReaderTarget | null>(null);
  const [taskTarget, setTaskTarget] = useState<TaskTarget | null>(null);

  useEffect(() => {
    window.ipc.invoke("app:getStatus", null).then(setStatus);
  }, []);

  const openPaper = useCallback((paperId: number, page: number | null) => {
    setReaderTarget({ paperId, page, nonce: Date.now() });
    setMode("reader");
  }, []);

  const openTask = useCallback((taskId: number) => {
    setTaskTarget({ taskId, nonce: Date.now() });
    setMode("tasks");
  }, []);

  return (
    <div className="flex h-full">
      <ModeRail
        mode={mode}
        onModeChange={setMode}
        dbOk={status === null ? null : status.dbOk}
        appDataPath={status?.appDataPath ?? ""}
      />
      <main className="min-w-0 flex-1">
        {mode === "settings" ? (
          <SettingsMode />
        ) : mode === "chat" ? (
          <ChatMode onOpenPaper={openPaper} />
        ) : mode === "reader" ? (
          <ReaderMode externalTarget={readerTarget} onOpenTask={openTask} />
        ) : mode === "tasks" ? (
          <TasksMode externalTarget={taskTarget} />
        ) : (
          <VaultMode />
        )}
      </main>
    </div>
  );
}
