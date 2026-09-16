import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConnectorAccess } from "@mental-lab/shared";
import { sidecarRequest } from "../models/apple.js";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  calendar: string;
  attendees: string[];
}

export async function probeCalendarAccess(): Promise<ConnectorAccess> {
  try {
    const msg = await sidecarRequest({ cmd: "calendar_probe" });
    return msg.granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "untitled"
  );
}

function eventToMarkdown(event: CalendarEvent): string {
  const attendees =
    event.attendees.length > 0 ? event.attendees.join(", ") : "";
  return `---
type: calendar-event
title: "${event.title.replace(/"/g, "'")}"
start: ${event.start}
end: ${event.end}
calendar: "${event.calendar.replace(/"/g, "'")}"
---

# ${event.title}

- When: ${event.start}${event.end ? ` → ${event.end}` : ""}${event.allDay ? " (all day)" : ""}
${event.location ? `- Where: ${event.location}\n` : ""}${attendees ? `- Attendees: ${attendees}\n` : ""}${event.calendar ? `- Calendar: ${event.calendar}\n` : ""}
${event.notes ? `\n${event.notes}\n` : ""}`;
}

/** Sync calendar events into <vault>/_sources/calendar. Returns file count written. */
export async function syncCalendar(
  vaultFolder: string,
  daysBack: number,
  daysForward: number
): Promise<number> {
  let payload = "";
  const msg = await sidecarRequest(
    { cmd: "calendar_events", daysBack, daysForward },
    (chunk) => {
      payload += chunk;
    }
  );
  if (msg.error) throw new Error(msg.error);

  let events: CalendarEvent[];
  try {
    events = JSON.parse(payload || "[]") as CalendarEvent[];
  } catch {
    throw new Error("Calendar data could not be parsed");
  }

  const dir = path.join(vaultFolder, "_sources", "calendar");
  await mkdir(dir, { recursive: true });

  let written = 0;
  for (const event of events) {
    const day = event.start.slice(0, 10) || "undated";
    const idHash = createHash("sha256").update(event.id).digest("hex").slice(0, 8);
    const filename = `${day}-${slugify(event.title)}-${idHash}.md`;
    const filePath = path.join(dir, filename);
    const content = eventToMarkdown(event);
    try {
      const existing = await readFile(filePath, "utf-8");
      if (existing === content) continue; // unchanged — don't touch mtime
    } catch {
      // new file
    }
    await writeFile(filePath, content, "utf-8");
    written++;
  }
  return written;
}
