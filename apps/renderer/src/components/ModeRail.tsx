import { useState } from "react";
import {
  BookOpenText,
  Brain,
  FlaskConical,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
} from "lucide-react";
import type { AppMode } from "@mental-lab/shared";

const MODES: { id: AppMode; label: string; icon: typeof MessagesSquare }[] = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "reader", label: "Reader", icon: BookOpenText },
  { id: "tasks", label: "Tasks", icon: FlaskConical },
  { id: "vault", label: "Vault", icon: Brain },
];

interface ModeRailProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  dbOk: boolean | null;
  appDataPath: string;
}

function RailButton({
  label,
  icon: Icon,
  active,
  expanded,
  onClick,
}: {
  label: string;
  icon: typeof MessagesSquare;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={expanded ? undefined : label}
      className={`relative flex h-11 items-center rounded-lg transition-colors ${
        expanded ? "w-full gap-2.5 px-3" : "w-11 justify-center"
      } ${
        active
          ? "bg-accent-wash text-accent-ink"
          : "text-ink-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-[9px] top-2 bottom-2 w-[3px] rounded-full bg-accent"
        />
      )}
      <Icon size={20} strokeWidth={1.75} className="shrink-0" />
      {expanded && <span className="text-sm">{label}</span>}
    </button>
  );
}

export default function ModeRail({
  mode,
  onModeChange,
  dbOk,
  appDataPath,
}: ModeRailProps) {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("railExpanded") === "true"
  );

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem("railExpanded", String(next));
  }

  return (
    <nav
      className={`relative flex h-full shrink-0 flex-col items-center bg-paper transition-[width] ${
        expanded ? "w-44" : "w-16"
      }`}
    >
      {/* Right-edge divider, starting below the titlebar / traffic lights */}
      <div
        aria-hidden
        className="absolute bottom-0 right-0 top-12 w-px bg-line"
      />

      {/* Drag strip clears the macOS traffic lights */}
      <div className="titlebar-drag h-12 w-full shrink-0" />

      <div
        className={`flex w-full flex-col gap-1.5 ${expanded ? "px-3" : "items-center"}`}
      >
        {MODES.map((m) => (
          <RailButton
            key={m.id}
            label={m.label}
            icon={m.icon}
            active={mode === m.id}
            expanded={expanded}
            onClick={() => onModeChange(m.id)}
          />
        ))}
      </div>

      <div
        className={`mt-auto flex w-full flex-col gap-1.5 pb-4 ${
          expanded ? "px-3" : "items-center"
        }`}
      >
        <RailButton
          label="Settings"
          icon={SlidersHorizontal}
          active={mode === "settings"}
          expanded={expanded}
          onClick={() => onModeChange("settings")}
        />
        <RailButton
          label={expanded ? "Collapse" : "Expand"}
          icon={expanded ? PanelLeftClose : PanelLeftOpen}
          active={false}
          expanded={expanded}
          onClick={toggle}
        />
        {/* Bench status: the lab's vital sign. */}
        <div
          className={`flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-ink-muted ${
            expanded ? "px-3 pt-1" : "justify-center pt-1"
          }`}
          title={
            dbOk === null
              ? "Checking the database…"
              : dbOk
                ? `Database ready — ${appDataPath}`
                : "Database is not responding"
          }
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              dbOk === null ? "bg-ink-muted" : dbOk ? "bg-ok" : "bg-amber"
            }`}
          />
          {expanded ? (dbOk ? "DB ready" : "DB") : "DB"}
        </div>
      </div>
    </nav>
  );
}
