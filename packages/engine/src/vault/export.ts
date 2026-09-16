import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigValue } from "../config.js";
import { getPaperDetail } from "../reader/index.js";

interface VaultSettingsSlice {
  folder: string | null;
}

function sanitizeNoteName(title: string): string {
  const cleaned = title
    .replace(/[/\\:#|[\]^]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled paper";
}

/** Write a paper's highlights + notes into the vault as a literature note. */
export async function exportPaperToVault(paperId: number): Promise<string> {
  const settings = await getConfigValue<VaultSettingsSlice>("vaultSettings");
  if (!settings?.folder) {
    throw new Error("Set up the Vault first (choose a folder in Vault mode)");
  }

  const detail = await getPaperDetail(paperId);
  const name = sanitizeNoteName(detail.meta.title);

  const highlightLines = detail.highlights.map((h) => {
    const note = h.note ? ` — ${h.note}` : "";
    return `- “${h.selectedText.replace(/\s+/g, " ").trim()}” (p. ${h.page})${note}`;
  });

  const sections: string[] = [
    `---`,
    `type: paper`,
    `tags: [paper, literature-note]`,
    `aliases: ["${detail.meta.originalFilename.replace(/"/g, "'")}"]`,
    `---`,
    ``,
    `# ${detail.meta.title}`,
    ``,
    `Imported paper · ${detail.meta.numPages} pages · exported ${new Date().toISOString().slice(0, 10)}`,
  ];

  if (detail.overview) {
    sections.push(``, `## Overview`, ``, detail.overview);
  }
  if (highlightLines.length > 0) {
    sections.push(``, `## Highlights`, ``, ...highlightLines);
  }
  if (detail.notes.trim()) {
    sections.push(``, `## Notes`, ``, detail.notes.trim());
  }

  await writeFile(
    path.join(settings.folder, `${name}.md`),
    sections.join("\n") + "\n",
    "utf-8"
  );
  return name;
}
