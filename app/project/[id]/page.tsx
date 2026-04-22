"use client";

import { use, useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Code2,
  ExternalLink,
  Globe2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";
import { Message, type ChatMessageView } from "@/components/chat/Message";
import { RightPane, type RightPaneTab } from "@/components/workspace/RightPane";
import { FileTree } from "@/components/workspace/FileTree";
import { CodeEditor } from "@/components/workspace/CodeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

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
  const [reviewingActive, setReviewingActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [chatWidthPct, setChatWidthPct] = useState(DEFAULT_CHAT_WIDTH_PCT);

  const [paths, setPaths] = useState<string[]>([]);
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileContentBase, setFileContentBase] = useState<string | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [saveIndicator, setSaveIndicator] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<RightPaneTab>("preview");

  const pendingRef = useRef<
    Map<string, { resolve: (msg: ProxyToBrowser) => void; reject: (err: Error) => void; timer: number }>
  >(new Map());
  const handleEventRef = useRef<(ev: ProxyToBrowser) => void>(() => {});

  const selectedPathRef = useRef<string | null>(null);
  const fileContentRef = useRef<string | null>(null);
  const fileContentBaseRef = useRef<string | null>(null);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
  useEffect(() => { fileContentRef.current = fileContent; }, [fileContent]);
  useEffect(() => { fileContentBaseRef.current = fileContentBase; }, [fileContentBase]);

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

  const sendRequest = useCallback(function sendRequest<T extends ProxyToBrowser>(
    msg: BrowserToProxy,
    requestId: string,
  ): Promise<T> {
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
        reject,
        timer,
      });
      ws.send(JSON.stringify(msg));
    });
  }, []);

  const requestFileList = useCallback(async () => {
    const requestId = crypto.randomUUID();
    setFileListLoading(true);
    setFileListError(null);
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.list.result" }>>(
        { type: "file.list", requestId },
        requestId,
      );
      setPaths(reply.paths.slice().sort());
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed";
      setFileListError(`File list failed: ${message}`);
    } finally {
      setFileListLoading(false);
    }
  }, [sendRequest]);

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
      if (ev.phase === "reviewing") setReviewingActive(true);
      if (ev.phase === "done") {
        setTurnInFlight(null);
        setReviewingActive(false);
      }
      return;
    }
    if (ev.type === "agent.chunk") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      setMessages((msgs) => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          if (m.agentId === evAgentId) {
            const next = msgs.slice();
            next[i] = { ...m, text: m.text + ev.delta };
            return next;
          }
          break;
        }
        return [
          ...msgs,
          {
            kind: "agent",
            turnId: ev.turnId,
            agentId: evAgentId,
            text: ev.delta,
            streaming: true,
            tools: [],
            footer: null,
          },
        ];
      });
      return;
    }
    if (ev.type === "agent.tool_use") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      setMessages((msgs) => {
        const label = summariseTool(ev.tool, ev.input);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          if (m.agentId === evAgentId) {
            const next = msgs.slice();
            next[i] = { ...m, tools: [...m.tools, label] };
            return next;
          }
          break;
        }
        return [
          ...msgs,
          {
            kind: "agent",
            turnId: ev.turnId,
            agentId: evAgentId,
            text: "",
            streaming: true,
            tools: [label],
            footer: null,
          },
        ];
      });
      return;
    }
    if (ev.type === "agent.done") {
      setMessages((msgs) => {
        const footer = formatDoneFooter(ev);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          const next = msgs.slice();
          next[i] = { ...m, streaming: false, footer };
          return next;
        }
        return msgs;
      });
      setTurnInFlight(null);
      setReviewingActive(false);
      return;
    }
    if (ev.type === "agent.error") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      setMessages((msgs) => [
        ...msgs,
        { kind: "error", turnId: ev.turnId, agentId: evAgentId, text: ev.message },
      ]);
      setTurnInFlight(null);
      setReviewingActive(false);
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

  useEffect(() => { handleEventRef.current = handleEvent; });

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
    const statusTimer = window.setTimeout(() => {
      if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
        setWsStatus("connecting");
        setFileListLoading(true);
        setFileListError(null);
      }
    }, 0);
    ws.onopen = async () => {
      setWsStatus("open");
      void requestFileList();
    };
    ws.onerror = () => {
      setFileListError((prev) => prev ?? "File list failed: websocket error");
      setFileListLoading(false);
    };
    ws.onclose = () => {
      setWsStatus("closed");
      setFileListLoading(false);
      for (const [requestId, entry] of pendingRef.current) {
        clearTimeout(entry.timer);
        entry.reject(new Error("ws closed"));
        pendingRef.current.delete(requestId);
      }
    };
    ws.onmessage = (ev) => {
      let parsed: ProxyToBrowser;
      try {
        parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
      } catch {
        return;
      }
      handleEventRef.current(parsed);
    };
    return () => {
      window.clearTimeout(statusTimer);
      ws.close();
    };
  }, [project?.status, id, requestFileList]);

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
  }, [sendRequest, turnInFlight]);

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
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
        <div className="w-full max-w-xl rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-lg" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (project.status === "PROVISIONING") {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
        <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <Button asChild variant="ghost" className="mb-5 w-fit">
            <Link href="/">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="mx-auto flex size-14 items-center justify-center rounded-lg border border-border bg-secondary">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Provisioning {project.name}...</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            First boot can take about a minute while the container pulls dependencies.
          </p>
        </section>
      </main>
    );
  }

  if (project.status !== "RUNNING") {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
        <section className="w-full max-w-xl rounded-lg border border-destructive/25 bg-card p-6 shadow-sm">
          <Button asChild variant="ghost" className="mb-5 w-fit">
            <Link href="/">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <AlertTriangle className="size-5 text-red-200" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-red-100">
                Project {project.status.toLowerCase()}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">The workspace is not available right now.</p>
            </div>
          </div>
        {project.provisioningError && (
          <pre className="mt-4 max-w-full overflow-auto rounded-md border border-destructive/25 bg-background p-3 text-left font-mono text-xs text-red-100">
            {project.provisioningError}
          </pre>
        )}
        </section>
      </main>
    );
  }

  const dirty = fileContent !== null && fileContent !== fileContentBase;
  const editorReadOnly = turnInFlight !== null;
  const wsOpen = wsStatus === "open";

  return (
    <main className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden bg-background">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to projects">
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold">{project.name}</h1>
              <Badge variant="success">running</Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {wsOpen ? <Wifi className="size-3.5 text-emerald-300" /> : <WifiOff className="size-3.5" />}
              <span>WS: {wsStatus}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.previewUrl && (
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <a href={project.previewUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Preview
              </a>
            </Button>
          )}
          <Badge variant={turnInFlight ? "warning" : "outline"} className="hidden sm:inline-flex">
            {turnInFlight ? "agent busy" : "ready"}
          </Badge>
        </div>
      </header>

      <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className="flex min-w-[280px] flex-col overflow-hidden border-r border-border bg-card max-md:min-w-0 max-md:flex-[0_0_42%]"
          style={{ flexBasis: `${chatWidthPct}%` }}
        >
          <div className="flex min-h-12 items-center justify-between border-b border-border px-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Chat</h2>
            </div>
            {turnInFlight && <Badge variant="warning">streaming</Badge>}
          </div>
          <ul className="flex flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
            {messages.length === 0 && (
              <li className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <Bot className="size-4 text-primary" />
                  Claude is ready
                </div>
                Ask for a change and watch files update in the editor.
              </li>
            )}
            {messages.map((m, idx) => (
              <Message key={(m.turnId ?? "err") + ":" + idx} m={m} />
            ))}
          </ul>
          <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-border bg-background/55 p-3">
            <label className="sr-only" htmlFor="agent-prompt">Prompt</label>
            <Textarea
              id="agent-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tell Claude what to change…"
              rows={3}
              disabled={wsStatus !== "open" || turnInFlight !== null}
              className="min-h-28"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {turnInFlight
                  ? reviewingActive
                    ? "Reviewing..."
                    : "Claude is thinking..."
                  : wsOpen
                    ? "Connected"
                    : "Waiting for websocket"}
              </span>
              <div className="flex gap-2">
                {turnInFlight && (
                  <Button
                    type="button"
                    onClick={onAbort}
                    variant="outline"
                    size="sm"
                    className="border-destructive/30 text-red-200 hover:bg-destructive/10 hover:text-red-100"
                  >
                    <Square />
                    Abort
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={wsStatus !== "open" || turnInFlight !== null || !prompt.trim()}
                  size="sm"
                >
                  <Send />
                  Send
                </Button>
              </div>
            </div>
          </form>
        </section>

        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
          onPointerDown={onResizeStart}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setChatWidthPct((v) => Math.max(MIN_CHAT_WIDTH_PCT, v - 2));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setChatWidthPct((v) => Math.min(MAX_CHAT_WIDTH_PCT, v + 2));
            }
          }}
          role="separator"
          tabIndex={0}
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
            <div className="flex h-full w-full bg-background">
              <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-card">
                <div className="flex min-h-11 items-center justify-between border-b border-border px-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Code2 className="size-4 text-primary" />
                    Files
                  </div>
                  <Button
                    type="button"
                    onClick={requestFileList}
                    variant="ghost"
                    size="icon"
                    aria-label="Refresh files"
                    className="size-8"
                  >
                    <RefreshCw className={fileListLoading ? "animate-spin" : ""} />
                  </Button>
                </div>
                <FileTree
                  paths={paths}
                  selectedPath={selectedPath}
                  loading={fileListLoading}
                  error={fileListError}
                  recentlyChanged={recentlyChanged}
                  onSelect={onSelectFile}
                  onRetry={requestFileList}
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
              <div className="flex min-w-0 flex-1 flex-col bg-background">
                <div className="flex min-h-11 items-center gap-2 border-b border-border bg-card px-3 text-xs text-muted-foreground">
                  <Globe2 className="size-4 text-primary" />
                  <span className="truncate font-mono">{project.previewUrl}</span>
                </div>
                <iframe
                  src={project.previewUrl}
                  className="w-full flex-1 border-0 bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="project preview"
                />
              </div>
            ) : (
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
                  <Globe2 className="size-5" />
                </div>
                No preview URL.
              </div>
            )
          }
        />
      </div>
    </main>
  );
}
