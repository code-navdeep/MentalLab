/**
 * Skills: reusable instruction sets the agent can follow. Each skill is a
 * directory containing SKILL.md with name/description frontmatter.
 * The system prompt lists name + description;
 * the agent reads the full SKILL.md with view_file when relevant.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  location: string;
}

const SKILL_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$|^[a-z0-9]$/;

export function parseFrontmatter(
  content: string
): { name?: string; description?: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  const yaml = match[1];

  const result: { name?: string; description?: string } = {};
  const nameMatch = yaml.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  if (nameMatch?.[1]) result.name = nameMatch[1].trim();

  let descMatch = yaml.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  if (descMatch?.[1]) {
    result.description = descMatch[1].replace(/\\(.)/g, "$1").trim();
  } else {
    descMatch = yaml.match(/^description:\s*'((?:[^'\\]|\\.)*)'\s*$/m);
    if (descMatch?.[1]) {
      result.description = descMatch[1].replace(/\\(.)/g, "$1").trim();
    } else {
      descMatch = yaml.match(/^description:\s*([^\n]+?)\s*$/m);
      if (descMatch?.[1]) result.description = descMatch[1].trim();
    }
  }
  return result;
}

let skillsDir: string | null = null;
let loadedSkills: Skill[] = [];

export function configureSkills(dir: string): void {
  skillsDir = dir;
}

export async function loadSkills(): Promise<Skill[]> {
  if (!skillsDir) return [];
  const skills: Skill[] = [];
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    loadedSkills = [];
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    if (
      !fm?.name ||
      !fm.description ||
      !SKILL_NAME_PATTERN.test(fm.name) ||
      fm.name !== entry.name ||
      fm.description.length > 1024
    ) {
      continue;
    }
    skills.push({
      name: fm.name,
      description: fm.description,
      location: skillMdPath,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  loadedSkills = skills;
  return skills;
}

export function getLoadedSkills(): Skill[] {
  return loadedSkills;
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const entries = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n    <instructions_file>${s.location}</instructions_file>\n  </skill>`
    )
    .join("\n");
  return `<available_skills>\n${entries}\n</available_skills>\n\nWhen a task matches a skill's description, read its instructions file with view_file and follow it.`;
}
