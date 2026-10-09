export interface ContentBlock {
  type: string;
  text?: string;
  data?: {
    name?: string;
    call_id?: string;
    arguments?: string;
    output?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface ContentBlockItem {
  type: "text" | "thinking";
  content: string;
}

function normalizeVisibleTextBlock(text: string | undefined): string {
  return text ?? "";
}

export function extractContentBlocks(
  content: unknown,
): ContentBlockItem[] | undefined {
  if (!Array.isArray(content)) return undefined;

  const blocks: ContentBlockItem[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === "thinking") {
      const thinking = (block as Record<string, unknown>).thinking;
      if (typeof thinking === "string" && thinking.trim()) {
        blocks.push({ type: "thinking", content: thinking });
      }
      continue;
    }

    if (block.type === "text") {
      const text = normalizeVisibleTextBlock(block.text);
      if (text) {
        blocks.push({ type: "text", content: text });
      }
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content || "");
  return (extractContentBlocks(content) || [])
    .filter((block) => block.type === "text")
    .map((block) => block.content)
    .join("\n");
}

/** Plain-text body for read-only history views (includes tool blocks). */
export function formatHistoryMessageText(content: unknown): string {
  const text = extractText(content).trim();
  if (text) return text;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    const b = block as Record<string, unknown>;
    if (
      b.type === "thinking" &&
      typeof b.thinking === "string" &&
      b.thinking.trim()
    ) {
      parts.push(b.thinking.trim());
      continue;
    }
    if (b.type === "tool_result" && typeof b.output === "string") {
      parts.push(b.output);
      continue;
    }
    if (b.type === "tool_use") {
      const name = typeof b.name === "string" ? b.name : "tool";
      const input =
        b.input !== undefined ? JSON.stringify(b.input, null, 2) : "";
      parts.push(input ? `${name}\n${input}` : name);
      continue;
    }
    if (b.type === "image" || b.type === "file") {
      const filename = b.filename ?? b.name;
      parts.push(
        typeof filename === "string" && filename.trim()
          ? filename
          : `[${String(b.type)}]`,
      );
    }
  }
  return parts.join("\n\n");
}

export interface DialogueHistoryMessage {
  role: string;
  content: unknown;
  id?: string;
  timestamp?: number;
}

const DIALOGUE_EXCLUDED_BLOCK_TYPES = new Set([
  "tool_use",
  "tool_result",
  "thinking",
]);

function stripNonDialogueBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return (content as ContentBlock[]).filter(
    (block) => !DIALOGUE_EXCLUDED_BLOCK_TYPES.has(String(block.type || "")),
  );
}

function hasDialogueContent(content: unknown): boolean {
  if (extractText(content).trim().length > 0) return true;
  if (!Array.isArray(content)) return false;
  return (content as ContentBlock[]).some((block) => {
    const type = String(block.type || "");
    return type === "image" || type === "file";
  });
}

/** User/assistant turns only — strips tool calls, tool results, and thinking. */
export function filterDialogueHistoryMessages<T extends DialogueHistoryMessage>(
  messages: T[],
): T[] {
  return messages
    .filter((msg) => {
      const role = msg.role || "";
      return role === "user" || role === "assistant";
    })
    .map((msg) => ({
      ...msg,
      content: stripNonDialogueBlocks(msg.content),
    }))
    .filter((msg) => hasDialogueContent(msg.content));
}

/**
 * Extract tool call / result data from a message's `content` array.
 */
