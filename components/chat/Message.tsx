"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ChatMessageView =
  | { kind: "user"; turnId: string; text: string }
  | {
      kind: "agent";
      turnId: string;
      text: string;
      streaming: boolean;
      tools: string[];
      footer: string | null;
    }
  | { kind: "error"; turnId: string | null; text: string };

export function Message({ m }: { m: ChatMessageView }) {
  if (m.kind === "user") {
    return (
      <li className="self-end max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-white">
        {m.text}
      </li>
    );
  }
  if (m.kind === "error") {
    return (
      <li className="rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-800">
        error: {m.text}
      </li>
    );
  }
  return (
    <li className="max-w-[85%] rounded-lg border border-gray-200 bg-white px-3 py-2">
      {m.tools.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5 text-xs italic text-gray-500">
          {m.tools.map((t, i) => (
            <li key={i}>→ {t}</li>
          ))}
        </ul>
      )}
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-sm [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-gray-900 [&_pre]:p-2 [&_pre]:text-xs [&_pre]:text-gray-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
        {m.streaming && <span>▎</span>}
      </div>
      {m.footer && <div className="mt-2 text-xs text-gray-400">{m.footer}</div>}
    </li>
  );
}
