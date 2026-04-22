"use client";

import { use, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  previewUrl: string | null;
  provisioningError: string | null;
};

type ChatMessage =
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

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_CHAT_WIDTH_PCT = 28;
const MIN_CHAT_WIDTH_PCT = 22;
const MAX_CHAT_WIDTH_PCT = 45;

function formatDoneFooter(d: {
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exitCode: number;
}): string {
  if (d.exitCode === -1) return "aborted";
  const secs = (d.durationMs / 1000).toFixed(1);
  const cost = d.costUsd.toFixed(3);
  return `${secs}s · ${d.tokensIn} in / ${d.tokensOut} out · $${cost}`;
}

function summariseTool(tool: string, input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const path =
      typeof o.file_path === "string"
        ? o.file_path
        : typeof o.path === "string"
          ? o.path
          : "";
    return path ? `${tool} ${path}` : tool;
  }
  return tool;
}

export default function ProjectWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [turnInFlight, setTurnInFlight] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [chatWidthPct, setChatWidthPct] = useState(DEFAULT_CHAT_WIDTH_PCT);

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = workspace.getBoundingClientRect();

    const updateWidth = (clientX: number) => {
      const next = ((clientX - rect.left) / rect.width) * 100;
      setChatWidthPct(Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, next)));
    };

    updateWidth(e.clientX);
    const onPointerMove = (ev: PointerEvent) => updateWidth(ev.clientX);
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function handleEvent(ev: ProxyToBrowser) {
    if (ev.type === "agent.status") {
      if (ev.phase === "done") setTurnInFlight(null);
      return;
    }
    if (ev.type === "agent.chunk") {
      setMessages((msgs) => {
        const i = msgs.findIndex((m) => m.kind === "agent" && m.turnId === ev.turnId);
        if (i < 0) {
          return [
            ...msgs,
            {
              kind: "agent",
              turnId: ev.turnId,
              text: ev.delta,
              streaming: true,
              tools: [],
              footer: null,
            },
          ];
        }
        const m = msgs[i];
        if (m.kind !== "agent") return msgs;
        const next = msgs.slice();
        next[i] = { ...m, text: m.text + ev.delta };
        return next;
      });
      return;
    }
    if (ev.type === "agent.tool_use") {
      setMessages((msgs) => {
        const i = msgs.findIndex((m) => m.kind === "agent" && m.turnId === ev.turnId);
        const label = summariseTool(ev.tool, ev.input);
        if (i < 0) {
          return [
            ...msgs,
            {
              kind: "agent",
              turnId: ev.turnId,
              text: "",
              streaming: true,
              tools: [label],
              footer: null,
            },
          ];
        }
        const m = msgs[i];
        if (m.kind !== "agent") return msgs;
        const next = msgs.slice();
        next[i] = { ...m, tools: [...m.tools, label] };
        return next;
      });
      return;
    }
    if (ev.type === "agent.done") {
      setMessages((msgs) => {
        const i = msgs.findIndex((m) => m.kind === "agent" && m.turnId === ev.turnId);
        const footer = formatDoneFooter(ev);
        if (i < 0) return msgs;
        const m = msgs[i];
        if (m.kind !== "agent") return msgs;
        const next = msgs.slice();
        next[i] = { ...m, streaming: false, footer };
        return next;
      });
      setTurnInFlight(null);
      return;
    }
    if (ev.type === "agent.error") {
      setMessages((msgs) => [
        ...msgs,
        { kind: "error", turnId: ev.turnId, text: ev.message },
      ]);
      setTurnInFlight(null);
      return;
    }
    // pong / error / other -> ignore silently
  }

  // Poll project until RUNNING or DESTROYED
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    async function loadOnce() {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { project: Project };
      if (cancelled) return;
      setProject(data.project);
      if (data.project.status === "PROVISIONING") {
        timer = window.setTimeout(loadOnce, POLL_INTERVAL_MS);
      }
    }
    loadOnce();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [id]);

  // Open WS once project is RUNNING
  useEffect(() => {
    if (project?.status !== "RUNNING") return;
    const base = process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:4100";
    const ws = new WebSocket(`${base}/p/${id}`);
    wsRef.current = ws;
    ws.onopen = () => setWsStatus("open");
    ws.onclose = () => setWsStatus("closed");
    ws.onmessage = (ev) => {
      let parsed: ProxyToBrowser;
      try {
        parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
      } catch {
        return;
      }
      handleEvent(parsed);
    };
    return () => ws.close();
  }, [project?.status, id]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ws = wsRef.current;
    const text = prompt.trim();
    if (!ws || ws.readyState !== WebSocket.OPEN || !text || turnInFlight) return;
    const turnId = crypto.randomUUID();
    setMessages((msgs) => [...msgs, { kind: "user", turnId, text }]);
    const msg: BrowserToProxy = { type: "agent.prompt", prompt: text, turnId };
    ws.send(JSON.stringify(msg));
    setTurnInFlight(turnId);
    setPrompt("");
  }

  function onAbort() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !turnInFlight) return;
    const msg: BrowserToProxy = { type: "agent.abort", turnId: turnInFlight };
    ws.send(JSON.stringify(msg));
  }

  if (!project) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-gray-500">
        Loading project…
      </main>
    );
  }

  if (project.status === "PROVISIONING") {
    return (
      <main className="mx-auto flex max-w-xl flex-1 flex-col items-center gap-4 p-8 text-center">
        <Link href="/" className="self-start text-sm underline">← back</Link>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
        <h1 className="text-xl font-semibold">Provisioning {project.name}…</h1>
        <p className="text-sm text-gray-500">First boot takes about a minute while the container pulls dependencies.</p>
      </main>
    );
  }

  if (project.status !== "RUNNING") {
    return (
      <main className="mx-auto flex max-w-xl flex-1 flex-col items-center gap-4 p-8 text-center">
        <Link href="/" className="self-start text-sm underline">← back</Link>
        <h1 className="text-xl font-semibold text-red-700">Project {project.status.toLowerCase()}</h1>
        {project.provisioningError && (
          <pre className="max-w-full overflow-auto rounded bg-red-50 p-3 text-left font-mono text-xs text-red-900">
            {project.provisioningError}
          </pre>
        )}
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-baseline justify-between border-b border-gray-200 p-3 px-4">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-sm underline">← back</Link>
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <span className="text-xs text-gray-500">WS: {wsStatus}</span>
        </div>
      </header>

      <div ref={workspaceRef} className="flex flex-1 overflow-hidden">
        <section
          className="flex min-w-[260px] flex-col overflow-hidden"
          style={{ flexBasis: `${chatWidthPct}%` }}
        >
          <h2 className="border-b border-gray-100 p-2 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">Chat</h2>
          <ul className="flex flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
            {messages.length === 0 && <li className="text-gray-400">No messages yet.</li>}
            {messages.map((m, idx) => {
              if (m.kind === "user") {
                return (
                  <li key={m.turnId + ":user"} className="self-end max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-white">
                    {m.text}
                  </li>
                );
              }
              if (m.kind === "error") {
                return (
                  <li key={(m.turnId ?? "err") + ":err:" + idx} className="rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-800">
                    error: {m.text}
                  </li>
                );
              }
              return (
                <li key={m.turnId + ":agent"} className="max-w-[85%] rounded-lg border border-gray-200 bg-white px-3 py-2">
                  {m.tools.length > 0 && (
                    <ul className="mb-2 flex flex-col gap-0.5 text-xs italic text-gray-500">
                      {m.tools.map((t, i) => (
                        <li key={i}>→ {t}</li>
                      ))}
                    </ul>
                  )}
                  <pre className="whitespace-pre-wrap font-sans">{m.text}{m.streaming && "▎"}</pre>
                  {m.footer && <div className="mt-2 text-xs text-gray-400">{m.footer}</div>}
                </li>
              );
            })}
          </ul>
          <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-gray-200 p-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tell Claude what to change…"
              rows={3}
              disabled={wsStatus !== "open" || turnInFlight !== null}
              className="rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {turnInFlight ? "Claude is thinking…" : ""}
              </span>
              <div className="flex gap-2">
                {turnInFlight && (
                  <button
                    type="button"
                    onClick={onAbort}
                    className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Abort
                  </button>
                )}
                <button
                  type="submit"
                  disabled={wsStatus !== "open" || turnInFlight !== null || !prompt.trim()}
                  className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </form>
        </section>

        <div
          className="w-1 shrink-0 cursor-col-resize bg-gray-200 transition hover:bg-gray-400"
          onPointerDown={onResizeStart}
          role="separator"
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH_PCT}
          aria-valuemax={MAX_CHAT_WIDTH_PCT}
          aria-valuenow={Math.round(chatWidthPct)}
        />

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <h2 className="border-b border-gray-100 p-2 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">Preview</h2>
          {project.previewUrl ? (
            <iframe
              src={project.previewUrl}
              className="flex-1 border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
              title="project preview"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">No preview URL.</div>
          )}
        </section>
      </div>
    </main>
  );
}
