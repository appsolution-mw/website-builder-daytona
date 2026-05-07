import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptImageAttachment } from "@wbd/protocol";

export interface PreparedAttachments {
  /** Text to append to the prompt for claude-code / openai-codex runtimes. */
  promptSuffix: string;
  /** Absolute paths of files written to disk. */
  paths: string[];
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return MIME_TO_EXT[normalized] ?? "bin";
}

/**
 * Decode base64 attachments and write them to a run-scoped directory under
 * `${projectRoot}/.agent-artifacts/chat-attachments/<runId>/`.
 *
 * Idempotent: re-runs with the same runId overwrite identical files.
 *
 * Returns the absolute paths and a prompt suffix that references them via
 * `@<absolute-path>` so Claude Code (auto-detects `@path`) and Codex (explicit
 * instruction to read via tools) can consume them as multimodal input.
 */
export async function prepareDiskAttachments(args: {
  projectRoot: string;
  runId: string;
  attachments: PromptImageAttachment[];
}): Promise<PreparedAttachments> {
  const { projectRoot, runId, attachments } = args;
  const dir = join(projectRoot, ".agent-artifacts", "chat-attachments", runId);
  await mkdir(dir, { recursive: true });

  const paths: string[] = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (!attachment) continue;
    const ext = extensionForMimeType(attachment.mimeType);
    const filePath = join(dir, `${index}.${ext}`);
    const buffer = Buffer.from(attachment.dataBase64, "base64");
    await writeFile(filePath, buffer);
    paths.push(filePath);
  }

  const bullets = paths.map((p) => `- @${p}`).join("\n");
  const promptSuffix =
    paths.length > 0
      ? `\n\n## Attached images\nThe user attached the following images. Read them when needed:\n${bullets}\n`
      : "";

  return { promptSuffix, paths };
}
