"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  previewUrl: string | null;
  provisioningError: string | null;
};

type ChatEntry = { id: string; from: "you" | "broker"; text: string };

const POLL_INTERVAL_MS = 2_000;

export default function ProjectWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Poll for project status until RUNNING or DESTROYED
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

  // Open WS only when project is RUNNING
  useEffect(() => {
    if (project?.status !== "RUNNING") return;
    const base = process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:4100";
    const ws = new WebSocket(`${base}/p/${id}`);
    wsRef.current = ws;
    setWsStatus("connecting");
    ws.onopen = () => setWsStatus("open");
    ws.onclose = () => setWsStatus("closed");
    ws.onmessage = (ev) => {
      let parsed: ProxyToBrowser;
      try {
        parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
      } catch {
        setChat((c) => [
          ...c,
          { id: crypto.randomUUID(), from: "broker", text: `malformed: ${String(ev.data).slice(0, 80)}` },
        ]);
        return;
      }
      const text =
        parsed.type === "pong"
          ? `pong (${parsed.nonce})`
          : parsed.type === "error"
            ? `error: ${parsed.code} — ${parsed.message}`
            : JSON.stringify(parsed);
      setChat((c) => [...c, { id: crypto.randomUUID(), from: "broker", text }]);
    };
    return () => ws.close();
  }, [project?.status, id]);

  function sendPing() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const nonce = crypto.randomUUID().slice(0, 8);
    const msg: BrowserToProxy = { type: "ping", nonce };
    ws.send(JSON.stringify(msg));
    setChat((c) => [...c, { id: crypto.randomUUID(), from: "you", text: `ping (${nonce})` }]);
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
        <button
          onClick={sendPing}
          disabled={wsStatus !== "open"}
          className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Send ping
        </button>
      </header>

      <div className="grid flex-1 grid-cols-2 gap-0 divide-x divide-gray-200 overflow-hidden">
        <section className="flex min-w-0 flex-col overflow-hidden">
          <h2 className="border-b border-gray-100 p-2 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">Chat</h2>
          <ul className="flex flex-1 flex-col gap-1 overflow-auto p-3 font-mono text-xs">
            {chat.length === 0 && <li className="text-gray-400">No messages yet.</li>}
            {chat.map((m) => (
              <li key={m.id} className={m.from === "you" ? "text-blue-700" : "text-gray-800"}>
                <span className="mr-2 text-gray-400">{m.from}:</span>
                {m.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-w-0 flex-col overflow-hidden">
          <h2 className="border-b border-gray-100 p-2 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">Preview</h2>
          {project.previewUrl ? (
            <iframe
              src={project.previewUrl}
              className="flex-1"
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
