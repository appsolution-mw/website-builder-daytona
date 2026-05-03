"use client";

import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { BrowserToProxy, ProxyToBrowser } from "@wbd/protocol";

type TerminalEvent = Extract<
  ProxyToBrowser,
  { type: "terminal.ready" | "terminal.output" | "terminal.exit" }
>;

export type XtermTerminalStatus = "offline" | "connecting" | "ready" | "closed";

export interface XtermTerminalProps {
  ws: WebSocket | null;
  wsOpen: boolean;
  disabled: boolean;
  event: { seq: number; event: TerminalEvent } | null;
  clearSignal: number;
  closeSignal: number;
  reconnectSignal: number;
  onStatusChange: (status: XtermTerminalStatus) => void;
}

function sendTerminalMessage(ws: WebSocket | null, message: BrowserToProxy): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

export function XtermTerminal({
  ws,
  wsOpen,
  disabled,
  event,
  clearSignal,
  closeSignal,
  reconnectSignal,
  onStatusChange,
}: XtermTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!wsOpen || !ws || disabled || !hostRef.current) {
      onStatusChange(wsOpen ? "closed" : "offline");
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#070a12",
        foreground: "#e6edf7",
        cursor: "#60a5fa",
        selectionBackground: "#1d4ed8",
        black: "#0b1020",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e6edf7",
        brightBlack: "#64748b",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    const requestId = crypto.randomUUID();

    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    requestIdRef.current = requestId;
    readyRef.current = false;
    onStatusChange("connecting");

    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();
    terminal.focus();
    terminal.writeln("Opening bash terminal...");

    sendTerminalMessage(ws, {
      type: "terminal.open",
      requestId,
      cols: terminal.cols,
      rows: terminal.rows,
    });

    const dataDisposable = terminal.onData((data) => {
      if (disabled) return;
      sendTerminalMessage(ws, { type: "terminal.input", requestId, data });
    });
    const resizeDisposable = terminal.onResize((size) => {
      sendTerminalMessage(ws, {
        type: "terminal.resize",
        requestId,
        cols: size.cols,
        rows: size.rows,
      });
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(hostRef.current);
    const readyTimer = window.setTimeout(() => {
      if (readyRef.current || requestIdRef.current !== requestId) return;
      terminal.writeln("");
      terminal.writeln("No terminal response from the sandbox broker.");
      terminal.writeln("Restart the sandbox so it uses the latest broker image with PTY support.");
    }, 2500);

    return () => {
      window.clearTimeout(readyTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      sendTerminalMessage(ws, { type: "terminal.close", requestId });
      terminal.dispose();
      if (requestIdRef.current === requestId) requestIdRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitRef.current === fitAddon) fitRef.current = null;
      onStatusChange(wsOpen ? "closed" : "offline");
    };
  }, [ws, wsOpen, disabled, reconnectSignal, onStatusChange]);

  useEffect(() => {
    if (!event) return;
    if (event.event.requestId !== requestIdRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (event.event.type === "terminal.ready") {
      readyRef.current = true;
      terminal.clear();
      onStatusChange("ready");
      terminal.focus();
      return;
    }

    if (event.event.type === "terminal.output") {
      terminal.write(event.event.data);
      return;
    }

    terminal.writeln("");
    terminal.writeln(`[process exited with code ${event.event.exitCode ?? "unknown"}]`);
    readyRef.current = false;
    onStatusChange("closed");
  }, [event, onStatusChange]);

  useEffect(() => {
    if (clearSignal === 0) return;
    terminalRef.current?.clear();
  }, [clearSignal]);

  useEffect(() => {
    if (closeSignal === 0) return;
    const requestId = requestIdRef.current;
    if (!requestId) return;
    sendTerminalMessage(ws, { type: "terminal.close", requestId });
  }, [closeSignal, ws]);

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-3" />
    </div>
  );
}
