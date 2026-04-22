"use client";

import { use, useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";
import { Message, type ChatMessageView } from "@/components/chat/Message";
import { RightPane, type RightPaneTab } from "@/components/workspace/RightPane";
import { FileTree } from "@/components/workspace/FileTree";
import { CodeEditor } from "@/components/workspace/CodeEditor";

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  previewUrl: string | null;
  provisioningError: string | null;
};

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_CHAT_WIDTH_PCT = 28;
const MIN_CHAT_WIDTH_PCT = 22;
const MAX_CHAT_WIDTH_PCT = 45;
const BADGE_DURATION_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;

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
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [prompt, setPrompt] = useState("");
  const [turnInFlight, setTurnInFlight] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [chatWidthPct, setChatWidthPct] = useState(DEFAULT_CHAT_WIDTH_PCT);

  const [paths, setPaths] = useState<string[]>([]);
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileContentBase, setFileContentBase] = useState<string | null>(null);
  const [saveIndicator, setSaveIndicator] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<RightPaneTab>("preview");

  const pendingRef = useRef<Map<string, { resolve: (msg: ProxyToBrowser) => void; timer: number }>>(new Map());
  const handleEventRef = useRef<(ev: ProxyToBrowser) => void>(() => {});

  const selectedPathRef = useRef<string | null>(null);
  const fileContentRef = useRef<string | null>(null);
  const fileContentBaseRef = useRef<string | null>(null);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
  useEffect(() => { fileContentRef.current = fileContent; }, [fileContent]);
  useEffect(() => { fileContentBaseRef.current = fileContentBase; }, [fileContentBase]);
  useEffect(() => { handleEventRef.current = handleEvent; });

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

  function sendRequest<T extends ProxyToBrowser>(msg: BrowserToProxy, requestId: string): Promise<T> {
    const ws = wsRef.current;
    return new Promise<T>((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("ws not open"));
        return;
      }
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error("request timeout"));
      }, REQUEST_TIMEOUT_MS);
      pendingRef.current.set(requestId, {
        resolve: (m) => resolve(m as T),
        timer,
      });
      ws.send(JSON.stringify(msg));
    });
  }

  function markChanged(path: string) {
    setRecentlyChanged((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    window.setTimeout(() => {
      setRecentlyChanged((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }, BADGE_DURATION_MS);
  }

  async function refreshOpenFile(path: string) {
    const requestId = crypto.randomUUID();
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path },
        requestId,
      );
      if (reply.error) {
        setSaveIndicator("error");
        setSaveError(reply.error);
        return;
      }
      if (typeof reply.content === "string") {
        setFileContent(reply.content);
        setFileContentBase(reply.content);
      }
    } catch {
      // swallow — WS drop surfaces via wsStatus
    }
  }

  function handleEvent(ev: ProxyToBrowser) {
    const maybeRequestId = (ev as { requestId?: string }).requestId;
    if (maybeRequestId && pendingRef.current.has(maybeRequestId)) {
      const entry = pendingRef.current.get(maybeRequestId)!;
      clearTimeout(entry.timer);
      pendingRef.current.delete(maybeRequestId);
      entry.resolve(ev);
      return;
    }

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

    if (ev.type === "file.changed") {
      setPaths((prev) => {
        if (ev.event === "add" && !prev.includes(ev.path)) return [...prev, ev.path].sort();
        if (ev.event === "unlink") return prev.filter((p) => p !== ev.path);
        return prev;
      });
      markChanged(ev.path);
      if (ev.event === "change" && ev.path === selectedPathRef.current) {
        const dirty = fileContentRef.current !== fileContentBaseRef.current;
        if (!dirty) {
          void refreshOpenFile(ev.path);
        }
      }
      return;
    }
  }

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

  useEffect(() => {
    if (project?.status !== "RUNNING") return;
    const base = process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:4100";
    const ws = new WebSocket(`${base}/p/${id}`);
    wsRef.current = ws;
    setWsStatus("connecting");
    ws.onopen = async () => {
      setWsStatus("open");
      const requestId = crypto.randomUUID();
      try {
        const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.list.result" }>>(
          { type: "file.list", requestId },
          requestId,
        );
        setPaths(reply.paths.slice().sort());
      } catch {
        // tree stays empty; user reloads page
      }
    };
    ws.onclose = () => setWsStatus("closed");
    ws.onmessage = (ev) => {
      let parsed: ProxyToBrowser;
      try {
        parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
      } catch {
        return;
      }
      handleEventRef.current(parsed);
    };
    return () => ws.close();
  }, [project?.status, id]);

  async function onSelectFile(path: string) {
    if (path === selectedPath) return;
    setSelectedPath(path);
    setFileContent(null);
    setFileContentBase(null);
    setSaveIndicator("idle");
    setSaveError(null);
    setTab("code");
    const requestId = crypto.randomUUID();
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path },
        requestId,
      );
      if (reply.error) {
        setSaveIndicator("error");
        setSaveError(reply.error);
        return;
      }
      if (typeof reply.content === "string") {
        setFileContent(reply.content);
        setFileContentBase(reply.content);
      }
    } catch {
      setSaveIndicator("error");
      setSaveError("request timeout");
    }
  }

  const onSave = useCallback(async () => {
    const path = selectedPathRef.current;
    const content = fileContentRef.current;
    if (!path || content === null) return;
    if (turnInFlight !== null) return;
    const requestId = crypto.randomUUID();
    setSaveIndicator("idle");
    setSaveError(null);
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.write.result" }>>(
        { type: "file.write", requestId, path, content },
        requestId,
      );
      if (reply.ok) {
        setFileContentBase(content);
        setSaveIndicator("saved");
        window.setTimeout(() => setSaveIndicator((s) => (s === "saved" ? "idle" : s)), 1500);
      } else {
        setSaveIndicator("error");
        setSaveError(reply.reason ?? "unknown");
      }
    } catch {
      setSaveIndicator("error");
      setSaveError("request timeout");
    }
  }, [turnInFlight]);

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

  const dirty = fileContent !== null && fileContent !== fileContentBase;
  const editorReadOnly = turnInFlight !== null;

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
            {messages.map((m, idx) => (
              <Message key={(m.turnId ?? "err") + ":" + idx} m={m} />
            ))}
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

        <RightPane
          tab={tab}
          onTabChange={setTab}
          code={
            <div className="flex h-full w-full">
              <aside className="w-60 shrink-0 overflow-auto border-r border-gray-200">
                <FileTree
                  paths={paths}
                  selectedPath={selectedPath}
                  recentlyChanged={recentlyChanged}
                  onSelect={onSelectFile}
                />
              </aside>
              <div className="flex min-w-0 flex-1">
                <CodeEditor
                  path={selectedPath}
                  content={fileContent}
                  readOnly={editorReadOnly}
                  dirty={dirty}
                  saveIndicator={saveIndicator}
                  saveError={saveError}
                  onContentChange={(c) => setFileContent(c)}
                  onSave={onSave}
                />
              </div>
            </div>
          }
          preview={
            project.previewUrl ? (
              <iframe
                src={project.previewUrl}
                className="w-full flex-1 border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                title="project preview"
              />
            ) : (
              <div className="flex w-full flex-1 items-center justify-center text-sm text-gray-400">No preview URL.</div>
            )
          }
        />
      </div>
    </main>
  );
}
