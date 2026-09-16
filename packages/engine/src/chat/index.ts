import { desc, eq, sql } from "drizzle-orm";
import type {
  ChatMessage,
  Citation,
  ConversationMeta,
  Tier,
} from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { retrieveContext } from "../indexer/search.js";
import {
  generateForFeature,
  streamForFeature,
  type ChatTurn,
} from "../models/index.js";

const HISTORY_TURNS = 10;

const SYSTEM_PROMPT = `You are the research assistant inside Mental Lab, answering from the user's own document library.

Ground your answers in the numbered sources provided. Cite a source inline as [n] wherever you draw on it. If the sources do not cover the question, say so plainly and answer from general knowledge only when the user would clearly want that, noting you are doing so.

Be direct and concise. Use markdown when it aids reading.`;

type ConversationRow = typeof conversations.$inferSelect;

function toMeta(r: ConversationRow): ConversationMeta {
  return {
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    pinned: r.pinned,
    tier: (r.tier as Tier | null) ?? null,
    folderIds: (r.folderIds as number[] | null) ?? null,
  };
}

export async function listConversations(): Promise<ConversationMeta[]> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt));
  return rows.map(toMeta);
}

export async function deleteConversation(conversationId: number): Promise<void> {
  const { db } = getDb();
  await db.delete(conversations).where(eq(conversations.id, conversationId));
}

export async function renameConversation(
  conversationId: number,
  title: string
): Promise<void> {
  const cleaned = title.trim().slice(0, 80);
  if (!cleaned) throw new Error("Title cannot be empty");
  const { db } = getDb();
  await db
    .update(conversations)
    .set({ title: cleaned })
    .where(eq(conversations.id, conversationId));
}

export async function setConversationTier(
  conversationId: number,
  tier: Tier | null
): Promise<void> {
  const { db } = getDb();
  await db
    .update(conversations)
    .set({ tier })
    .where(eq(conversations.id, conversationId));
}

export async function setConversationSources(
  conversationId: number,
  folderIds: number[] | null
): Promise<void> {
  const { db } = getDb();
  await db
    .update(conversations)
    .set({ folderIds })
    .where(eq(conversations.id, conversationId));
}

export async function setConversationPinned(
  conversationId: number,
  pinned: boolean
): Promise<void> {
  const { db } = getDb();
  await db
    .update(conversations)
    .set({ pinned })
    .where(eq(conversations.id, conversationId));
}

export async function getConversation(conversationId: number): Promise<{
  meta: ConversationMeta;
  messages: ChatMessage[];
}> {
  const { db } = getDb();
  const convRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const conv = convRows[0];
  if (!conv) throw new Error("Conversation not found");

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt, messages.id);

  return {
    meta: toMeta(conv),
    messages: msgRows.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      citations: (m.citations as Citation[] | null) ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function sendChatMessage(opts: {
  conversationId: number | null;
  message: string;
  tier?: Tier | null;
  folderIds?: number[] | null;
  onDelta: (delta: string) => void;
}): Promise<{ conversationId: number; citations: Citation[] }> {
  const { db } = getDb();

  // Create the conversation on first message.
  let conversationId = opts.conversationId;
  let isNew = false;
  if (conversationId === null) {
    const inserted = await db
      .insert(conversations)
      .values({ tier: opts.tier ?? null, folderIds: opts.folderIds ?? null })
      .returning({ id: conversations.id });
    conversationId = inserted[0]!.id;
    isNew = true;
  }

  // Per-conversation settings (difficulty tier override, source scope).
  const convRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const conv = convRows[0];
  const tierOverride = (conv?.tier as Tier | null) ?? null;
  const folderScope = (conv?.folderIds as number[] | null) ?? null;

  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: opts.message,
  });

  // Retrieve grounding context and build the numbered source block.
  const context = await retrieveContext(opts.message, 8, undefined, folderScope);
  const sources: Citation[] = context.map((c, i) => ({
    n: i + 1,
    fileId: c.fileId,
    path: c.path,
    relPath: c.relPath,
    page: c.page,
    snippet: c.snippet,
  }));

  const sourceBlock =
    context.length > 0
      ? "Sources:\n" +
        context
          .map(
            (c, i) =>
              `[${i + 1}] ${c.relPath}${c.page !== null ? ` (page ${c.page})` : ""}\n${c.fullText}`
          )
          .join("\n\n")
      : "No sources matched this question in the library.";

  // History (excluding the just-inserted user turn).
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HISTORY_TURNS + 1);
  const turns: ChatTurn[] = history
    .slice(1)
    .reverse()
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  turns.push({
    role: "user",
    content: `${sourceBlock}\n\n---\n\nQuestion: ${opts.message}`,
  });

  let answer = "";
  await streamForFeature(
    "doc-chat",
    { system: SYSTEM_PROMPT, messages: turns, tierOverride },
    (delta) => {
      answer += delta;
      opts.onDelta(delta);
    }
  );

  // Keep only sources the answer actually cites.
  const citedNumbers = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
  );
  const citations = sources.filter((s) => citedNumbers.has(s.n));

  await db.insert(messages).values({
    conversationId,
    role: "assistant",
    content: answer,
    citations,
  });
  await db
    .update(conversations)
    .set({ updatedAt: sql`now()` })
    .where(eq(conversations.id, conversationId));

  if (isNew) {
    void nameConversation(conversationId, opts.message, answer);
  }

  return { conversationId, citations };
}

async function nameConversation(
  conversationId: number,
  question: string,
  answer: string
): Promise<void> {
  try {
    const title = await generateForFeature(
      "titles",
      `Write a title of at most five words for a conversation that starts with this question. Reply with the title only, no quotes.\n\nQuestion: ${question}\n\nAnswer began: ${answer.slice(0, 300)}`
    );
    const cleaned = title.replace(/^["']|["']$/g, "").slice(0, 80);
    if (cleaned) {
      const { db } = getDb();
      await db
        .update(conversations)
        .set({ title: cleaned })
        .where(eq(conversations.id, conversationId));
    }
  } catch {
    // Naming is best-effort; the default title stands.
  }
}
