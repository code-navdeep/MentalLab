import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConnectorAccess } from "@mental-lab/shared";

const MAIL_ROOT = path.join(os.homedir(), "Library", "Mail");
const MAX_MESSAGES_PER_SYNC = 500;
const BODY_LIMIT = 5000;

export async function probeMailAccess(): Promise<ConnectorAccess> {
  try {
    await readdir(MAIL_ROOT);
    return "granted";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return "denied";
    if (code === "ENOENT") return "denied"; // no local Mail store at all
    return "unknown";
  }
}

/** Recursively find .emlx files newer than cutoff. Depth-bounded walk. */
async function findRecentEmlx(
  dir: string,
  cutoff: number,
  depth: number,
  out: { path: string; mtime: number }[]
): Promise<void> {
  if (depth > 12) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findRecentEmlx(full, cutoff, depth + 1, out);
    } else if (entry.name.endsWith(".emlx")) {
      try {
        const s = await stat(full);
        if (s.mtimeMs >= cutoff) out.push({ path: full, mtime: s.mtimeMs });
      } catch {
        // unreadable — skip
      }
    }
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "no-subject"
  );
}

/** Parse one emlx file: length-prefixed RFC822 message + trailing plist. */
async function parseEmlx(filePath: string): Promise<{
  from: string;
  to: string;
  subject: string;
  date: Date | null;
  body: string;
} | null> {
  const { simpleParser } = await import("mailparser");
  let raw: Buffer;
  try {
    raw = await readFile(filePath);
  } catch {
    return null;
  }
  const newlineIdx = raw.indexOf(0x0a);
  if (newlineIdx < 0) return null;
  const byteCount = Number(raw.subarray(0, newlineIdx).toString().trim());
  const messageBytes = Number.isFinite(byteCount)
    ? raw.subarray(newlineIdx + 1, newlineIdx + 1 + byteCount)
    : raw.subarray(newlineIdx + 1);

  try {
    const parsed = await simpleParser(messageBytes);
    const toText = Array.isArray(parsed.to)
      ? parsed.to.map((t) => t.text).join(", ")
      : (parsed.to?.text ?? "");
    return {
      from: parsed.from?.text ?? "",
      to: toText,
      subject: parsed.subject ?? "(no subject)",
      date: parsed.date ?? null,
      body: (parsed.text ?? "").trim(),
    };
  } catch {
    return null;
  }
}

/** Sync recent Apple Mail messages into <vault>/_sources/mail. */
export async function syncMail(
  vaultFolder: string,
  daysBack: number
): Promise<number> {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const found: { path: string; mtime: number }[] = [];
  await findRecentEmlx(MAIL_ROOT, cutoff, 0, found);
  found.sort((a, b) => b.mtime - a.mtime);
  const batch = found.slice(0, MAX_MESSAGES_PER_SYNC);

  const dir = path.join(vaultFolder, "_sources", "mail");
  await mkdir(dir, { recursive: true });

  let written = 0;
  for (const item of batch) {
    const parsed = await parseEmlx(item.path);
    if (!parsed) continue;

    const idHash = createHash("sha256").update(item.path).digest("hex").slice(0, 8);
    const day = parsed.date
      ? parsed.date.toISOString().slice(0, 10)
      : "undated";
    const filename = `${day}-${slugify(parsed.subject)}-${idHash}.md`;
    const filePath = path.join(dir, filename);

    const body =
      parsed.body.length > BODY_LIMIT
        ? parsed.body.slice(0, BODY_LIMIT) + "\n\n[truncated]"
        : parsed.body;
    const content = `---
type: email
subject: "${parsed.subject.replace(/"/g, "'")}"
from: "${parsed.from.replace(/"/g, "'")}"
to: "${parsed.to.replace(/"/g, "'")}"
date: ${parsed.date ? parsed.date.toISOString() : "unknown"}
---

# ${parsed.subject}

From: ${parsed.from}
To: ${parsed.to}
Date: ${parsed.date ? parsed.date.toLocaleString() : "unknown"}

${body}
`;
    try {
      const existing = await readFile(filePath, "utf-8");
      if (existing === content) continue;
    } catch {
      // new file
    }
    await writeFile(filePath, content, "utf-8");
    written++;
  }
  return written;
}
