"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";

type ChatEntry = { id: string; from: "you" | "broker"; text: string };

export default function ProjectWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:4100";
    const ws = new WebSocket(`${base}/p/${id}`);
    wsRef.current = ws;
    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onmessage = (ev) => {
      const parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
      const text =
        parsed.type === "pong"
          ? `pong (${parsed.nonce})`
          : parsed.type === "error"
            ? `error: ${parsed.code} — ${parsed.message}`
            : JSON.stringify(parsed);
      setChat((c) => [...c, { id: crypto.randomUUID(), from: "broker", text }]);
    };
    return () => ws.close();
  }, [id]);

  function sendPing() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const nonce = crypto.randomUUID().slice(0, 8);
    const msg: BrowserToProxy = { type: "ping", nonce };
    ws.send(JSON.stringify(msg));
    setChat((c) => [...c, { id: crypto.randomUUID(), from: "you", text: `ping (${nonce})` }]);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Project {id}</h1>
        <Link href="/" className="text-sm underline">
          ← back
        </Link>
      </div>
      <div className="text-xs text-gray-500">
        WS: <span className={status === "open" ? "text-green-600" : status === "closed" ? "text-red-600" : "text-gray-500"}>{status}</span>
      </div>

      <button
        onClick={sendPing}
        disabled={status !== "open"}
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        Send ping
      </button>

      <ul className="flex flex-col gap-1 rounded border border-gray-200 p-3 font-mono text-sm">
        {chat.length === 0 && <li className="text-gray-400">No messages yet.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.from === "you" ? "text-blue-700" : "text-gray-800"}>
            <span className="mr-2 text-gray-400">{m.from}:</span>
            {m.text}
          </li>
        ))}
      </ul>
    </main>
  );
}
