import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { startBroker, type BrokerHandle } from "../src/ws-server";

const CLAUDE_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const promptMsg = (
  prompt: string,
  turnId: string,
  resumeSession = false,
  attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>,
) => ({
  type: "agent.prompt" as const,
  prompt,
  turnId,
  runtime: "claude-code" as const,
  sessionId: "chat-session-1",
  providerSessionId: CLAUDE_SESSION_ID,
  resumeSession,
  ...(attachments ? { attachments } : {}),
});

function collectSocketEvents(client: WebSocket): unknown[] {
  const events: unknown[] = [];
  client.on("message", (data) => events.push(JSON.parse(data.toString())));
  return events;
}

async function waitForEvent<T extends { type?: string }>(
  events: unknown[],
  type: string,
  requestId: string,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const event = events.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: string }).type === type &&
        (entry as { requestId?: string }).requestId === requestId,
    );
    if (event) return event as T;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`never saw ${type}`);
}

function createFakePtySpawn() {
  const terminals: Array<{
    file: string;
    args: string[];
    options: { cwd?: string; cols?: number; rows?: number };
    writes: string[];
    resizes: Array<{ cols: number; rows: number }>;
    killed: boolean;
    emitData: (data: string) => void;
    emitExit: (exitCode: number, signal?: number) => void;
  }> = [];

  const spawn = (file: string, args: string[], options: { cwd?: string; cols?: number; rows?: number }) => {
    const emitter = new EventEmitter();
    const terminal = {
      file,
      args,
      options,
      writes: [] as string[],
      resizes: [] as Array<{ cols: number; rows: number }>,
      killed: false,
      emitData: (data: string) => emitter.emit("data", data),
      emitExit: (exitCode: number, signal?: number) => emitter.emit("exit", { exitCode, signal }),
    };
    terminals.push(terminal);
    return {
      pid: terminals.length,
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      process: file,
      handleFlowControl: false,
      onData: (listener: (data: string) => void) => {
        emitter.on("data", listener);
        return { dispose: () => emitter.off("data", listener) };
      },
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        emitter.on("exit", listener);
        return { dispose: () => emitter.off("exit", listener) };
      },
      resize: (cols: number, rows: number) => {
        terminal.resizes.push({ cols, rows });
      },
      clear: () => undefined,
      write: (data: string | Buffer) => {
        terminal.writes.push(data.toString());
      },
      kill: () => {
        terminal.killed = true;
        terminal.emitExit(0);
      },
      pause: () => undefined,
      resume: () => undefined,
    };
  };

  return { spawn, terminals };
}

describe("broker ws server", () => {
  let handle: BrokerHandle | undefined;
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it("starts, accepts a connection, and tears it down on close()", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    expect(handle.port).toBeGreaterThan(0);

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    // Let handle.close() (from afterEach) terminate the client. Assert the
    // client sees a close event as a result.
    await Promise.all([
      new Promise<void>((resolve) => client.once("close", () => resolve())),
      handle.close(),
    ]);
    handle = undefined;
  });

  it("echoes ping → pong over a real socket", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const reply = await new Promise<string>((resolve, reject) => {
      client.once("message", (data) => resolve(data.toString()));
      client.once("error", reject);
      client.send(JSON.stringify({ type: "ping", nonce: "xyz" }));
    });

    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "xyz" });
    client.close();
  });

  it("rejects a second agent.prompt while the first is still running", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const errors: unknown[] = [];
    client.on("message", (d) => errors.push(JSON.parse(d.toString())));

    client.send(JSON.stringify(promptMsg("first", "t1")));
    client.send(JSON.stringify(promptMsg("second", "t2")));

    // Wait briefly for the broker to process and reject the second message
    await new Promise((r) => setTimeout(r, 200));

    const secondRejection = errors.find(
      (e): e is { type: "agent.error"; turnId: string; message: string } =>
        typeof e === "object" &&
        e !== null &&
        (e as { type?: string }).type === "agent.error" &&
        (e as { turnId?: string }).turnId === "t2",
    );
    expect(secondRejection).toBeDefined();
    expect(secondRejection?.message).toMatch(/already running/);
    client.close();
  });

  it("responds to file.list with sorted paths", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-list-"));
    await writeFile(join(root, "b.ts"), "b");
    await writeFile(join(root, "a.ts"), "a");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: true });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "file.list", requestId: "r1" }));
    });

    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("file.list.result");
    expect(parsed.requestId).toBe("r1");
    expect(parsed.paths).toEqual(["a.ts", "b.ts"]);
    client.close();
  });

  it("responds to file.read with content for a text file", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-read-"));
    await writeFile(join(root, "hi.txt"), "hello!");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "file.read", requestId: "r2", path: "hi.txt" }));
    });

    expect(JSON.parse(reply)).toEqual({
      type: "file.content",
      requestId: "r2",
      path: "hi.txt",
      content: "hello!",
    });
    client.close();
  });

  it("responds to file.delete and removes empty parent directories", async () => {
    const { mkdtemp, writeFile, mkdir, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-delete-"));
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app", "wbd-next-devtools.css"), "stale");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({
        type: "file.delete",
        requestId: "d1",
        path: "app/wbd-next-devtools.css",
        cleanupEmptyParents: true,
      }));
    });

    expect(JSON.parse(reply)).toEqual({
      type: "file.delete.result",
      requestId: "d1",
      path: "app/wbd-next-devtools.css",
      ok: true,
    });
    await expect(stat(join(root, "app"))).rejects.toMatchObject({ code: "ENOENT" });
    client.close();
  });

  it("runs terminal commands in the project root and streams output", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-terminal-"));
    await writeFile(join(root, "marker.txt"), "from-project-root");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify({
      type: "terminal.run",
      requestId: "term-1",
      command: "node -e \"const fs=require('fs'); process.stdout.write(fs.readFileSync('marker.txt','utf8')); process.stderr.write('warn');\"",
    }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string }).type === "terminal.exit")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const outputs = events.filter((e) => (e as { type?: string }).type === "terminal.output") as Array<{
      stream: "stdout" | "stderr";
      data: string;
    }>;
    expect(outputs.filter((e) => e.stream === "stdout").map((e) => e.data).join("")).toBe("from-project-root");
    expect(outputs.filter((e) => e.stream === "stderr").map((e) => e.data).join("")).toBe("warn");
    expect(events.find((e) => (e as { type?: string }).type === "terminal.exit")).toMatchObject({
      type: "terminal.exit",
      requestId: "term-1",
      ok: true,
      exitCode: 0,
    });
    client.close();
  });

  it("opens an interactive terminal, forwards input, resize, output, and close events", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-pty-"));
    const fakePty = createFakePtySpawn();

    handle = await startBroker({
      port: 0,
      projectRoot: root,
      enableFsTracker: false,
      __testPtySpawn: fakePty.spawn,
    });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));
    const events = collectSocketEvents(client);

    client.send(JSON.stringify({
      type: "terminal.open",
      requestId: "pty-1",
      cols: 100,
      rows: 30,
    }));

    await expect(waitForEvent(events, "terminal.ready", "pty-1")).resolves.toMatchObject({
      type: "terminal.ready",
      requestId: "pty-1",
      pid: 1,
    });
    expect(fakePty.terminals[0]).toMatchObject({
      options: {
        cwd: root,
        cols: 100,
        rows: 30,
      },
    });

    fakePty.terminals[0].emitData("hello from shell\r\n");
    await expect(waitForEvent(events, "terminal.output", "pty-1")).resolves.toMatchObject({
      type: "terminal.output",
      requestId: "pty-1",
      stream: "stdout",
      data: "hello from shell\r\n",
    });

    client.send(JSON.stringify({ type: "terminal.input", requestId: "pty-1", data: "pwd\r" }));
    client.send(JSON.stringify({ type: "terminal.resize", requestId: "pty-1", cols: 120, rows: 40 }));
    client.send(JSON.stringify({ type: "terminal.close", requestId: "pty-1" }));

    const start = Date.now();
    while (Date.now() - start < 500) {
      if (fakePty.terminals[0].writes.length > 0 && fakePty.terminals[0].resizes.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(fakePty.terminals[0].writes).toEqual(["pwd\r"]);
    expect(fakePty.terminals[0].resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(fakePty.terminals[0].killed).toBe(true);
    await expect(waitForEvent(events, "terminal.exit", "pty-1")).resolves.toMatchObject({
      type: "terminal.exit",
      requestId: "pty-1",
      ok: true,
      exitCode: 0,
    });
    client.close();
  });

  it("refuses terminal.run with reason:locked while a turn is running", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn } = spawnsSetup([
      {
        stdout: [],
        closeDelayMs: 1000,
      },
    ]);

    handle = await startBroker({
      port: 0,
      projectRoot: process.cwd(),
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("x", "t1")));
    client.send(JSON.stringify({ type: "terminal.run", requestId: "term-locked", command: "pwd" }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      const exit = events.find(
        (e) =>
          (e as { type?: string }).type === "terminal.exit" &&
          (e as { requestId?: string }).requestId === "term-locked",
      );
      if (exit) {
        expect(exit).toMatchObject({
          type: "terminal.exit",
          requestId: "term-locked",
          ok: false,
          reason: "locked",
        });
        client.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("never saw terminal.exit");
  });

  it("refuses file.write with reason:locked while a turn is running", async () => {
    handle = await startBroker({ port: 0, projectRoot: process.cwd(), enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const replies: unknown[] = [];
    client.on("message", (data) => replies.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("x", "t1")));
    client.send(JSON.stringify({ type: "file.write", requestId: "w1", path: "x.txt", content: "y" }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      const write = replies.find(
        (r: unknown) =>
          typeof r === "object" && r !== null &&
          (r as { type?: string }).type === "file.write.result" &&
          (r as { requestId?: string }).requestId === "w1",
      );
      if (write) {
        expect((write as { ok: boolean }).ok).toBe(false);
        expect((write as { reason?: string }).reason).toBe("locked");
        client.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("never saw file.write.result");
  });

  it("runs reviewer after coder turn that wrote files", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      // coder
      {
        stdout: [
          { type: "system", subtype: "init" },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tu-write-1",
                  name: "Write",
                  input: { file_path: "/workspace/project/x.txt", content: "ok" },
                },
                { type: "text", text: "wrote x.txt" },
              ],
            },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 1000,
            usage: {
              input_tokens: 5,
              output_tokens: 10,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 100,
            },
            total_cost_usd: 0.002,
          },
        ],
      },
      // reviewer
      {
        stdout: [
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "✅ Passed" }] },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 200,
            usage: {
              input_tokens: 2,
              output_tokens: 3,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
            },
            total_cost_usd: 0.0005,
          },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("write x", "t1")));

    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.done" && (e as { turnId?: string }).turnId === "t1")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(2);
    const coderArgv = spawns[0].argv;
    expect(coderArgv[coderArgv.indexOf("--session-id") + 1]).toBe(CLAUDE_SESSION_ID);
    const reviewerArgv = spawns[1].argv;
    expect(reviewerArgv[reviewerArgv.indexOf("--print") + 1]).toMatch(/reviewer sub-agent/i);

    const reviewing = events.find(
      (e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing",
    );
    expect(reviewing).toBeDefined();

    const chunks = events.filter((e) => (e as { type?: string }).type === "agent.chunk");
    expect(chunks).toEqual([
      { type: "agent.chunk", turnId: "t1", delta: "Fertig — ich habe die Änderung umgesetzt." },
    ]);
    expect(JSON.stringify(events)).not.toContain("wrote x.txt");
    expect(JSON.stringify(events)).not.toContain("✅ Passed");

    const dones = events.filter((e) => (e as { type?: string }).type === "agent.done");
    expect(dones.length).toBe(1);
    const done = dones[0] as { tokensIn: number; tokensOut: number; durationMs: number; costUsd: number };
    expect(done.tokensIn).toBe(5 + 2);
    expect(done.tokensOut).toBe(10 + 3);
    expect(done.durationMs).toBe(1000 + 200);
    expect(done.costUsd).toBeCloseTo(0.002 + 0.0005, 6);
    expect((done as { usage?: { totalTokens?: number } }).usage?.totalTokens).toBe(5 + 10 + 50 + 100 + 2 + 3 + 20 + 30);

    const usageEvents = events.filter((e) => (e as { type?: string }).type === "agent.usage");
    expect(usageEvents.map((e) => (e as { label?: string }).label)).toEqual([
      "coder",
      "reviewer",
      "turn",
    ]);
    const turnUsage = usageEvents.find((e) => (e as { label?: string }).label === "turn") as
      | { usage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number; totalTokens?: number } }
      | undefined;
    expect(turnUsage?.usage?.cacheCreationInputTokens).toBe(70);
    expect(turnUsage?.usage?.cacheReadInputTokens).toBe(130);
    expect(turnUsage?.usage?.totalTokens).toBe(220);

    client.close();
  });

  it("skips reviewer when coder wrote no files", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          { type: "system", subtype: "init" },
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "This project uses Next.js." }] },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 400,
            usage: { input_tokens: 3, output_tokens: 5 },
            total_cost_usd: 0.001,
          },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("what is this?", "t2")));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.done" && (e as { turnId?: string }).turnId === "t2")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(1);
    expect(events.some((e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing")).toBe(false);
    const chunks = events.filter((e) => (e as { type?: string }).type === "agent.chunk");
    expect(chunks).toEqual([
      { type: "agent.chunk", turnId: "t2", delta: "This project uses Next.js." },
    ]);
    client.close();
  });

  it("writes prompt image attachments and passes their paths to Claude", async () => {
    const { mkdtemp, readFile, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-images-"));
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          {
            type: "result",
            subtype: "success",
            duration_ms: 10,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      projectRoot: root,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("match this screenshot", "t-img", false, [
      {
        name: "Screen Shot.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("fake image bytes").toString("base64"),
      },
    ])));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string }).type === "agent.done")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(1);
    const argv = spawns[0].argv;
    const prompt = argv[argv.indexOf("--print") + 1];
    expect(prompt).toContain("match this screenshot");
    expect(prompt).toContain(".agent-artifacts/chat-uploads/t-img/1-Screen-Shot.png");

    const imagePath = join(root, ".agent-artifacts", "chat-uploads", "t-img", "1-Screen-Shot.png");
    await expect(stat(imagePath)).resolves.toBeDefined();
    await expect(readFile(imagePath, "utf8")).resolves.toBe("fake image bytes");
    client.close();
  });

  it("passes prompt image attachments to OpenHands as a native image manifest", async () => {
    const { mkdtemp, readFile, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-openhands-images-"));
    const imageBase64 = Buffer.from("fake image bytes").toString("base64");
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          { type: "done", durationMs: 10, tokensIn: 1, tokensOut: 1, costUsd: 0 },
        ],
      },
    ]);

    try {
      handle = await startBroker({
        port: 0,
        projectRoot: root,
        enableFsTracker: false,
        __testSpawn: fakeSpawn,
      });

      const client = new WebSocket(`ws://localhost:${handle.port}`);
      await new Promise<void>((resolve) => client.once("open", () => resolve()));

      const events: unknown[] = [];
      client.on("message", (data) => events.push(JSON.parse(data.toString())));

      client.send(JSON.stringify({
        ...promptMsg("match this screenshot", "t-openhands-img", false, [
          {
            name: "Screen Shot.png",
            mimeType: "image/png",
            dataBase64: imageBase64,
          },
        ]),
        runtime: "openhands",
        modelId: "openrouter:openai/gpt-4o",
      }));

      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (events.some((e) => (e as { type?: string }).type === "agent.done")) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(spawns.length).toBe(1);
      const argv = spawns[0].argv;
      expect(argv).toContain("--attachments-manifest");
      const manifestPath = argv[argv.indexOf("--attachments-manifest") + 1];
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      expect(manifest).toEqual({
        imageUrls: [`data:image/png;base64,${imageBase64}`],
      });

      const imagePath = join(root, ".agent-artifacts", "chat-uploads", "t-openhands-img", "1-Screen-Shot.png");
      await expect(stat(imagePath)).resolves.toBeDefined();
      await expect(readFile(imagePath, "utf8")).resolves.toBe("fake image bytes");
      client.close();
    } finally {
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
    }
  });

  it("skips reviewer when coder emits an error", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          { type: "system", subtype: "init" },
          { type: "result", subtype: "error_max_turns" },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify(promptMsg("foo", "t3")));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.error" && (e as { turnId?: string }).turnId === "t3")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(1);
    expect(events.some((e) => (e as { type?: string }).type === "agent.error")).toBe(true);
    expect(events.some((e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing")).toBe(false);
    client.close();
  });

  it("rejects internal queue drain without a valid bearer token", async () => {
    process.env.BROKER_TOKEN = "broker-secret";
    handle = await startBroker({ port: 0, enableFsTracker: false });

    const missing = await fetch(`http://127.0.0.1:${handle.port}/internal/projects/p1/queue/drain`, {
      method: "POST",
    });
    const wrong = await fetch(`http://127.0.0.1:${handle.port}/internal/projects/p1/queue/drain`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: "missing-broker-token" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: "invalid-broker-token" });
  });

  it("calls the queue drain hook for valid internal requests", async () => {
    process.env.BROKER_TOKEN = "broker-secret";
    const drained: string[] = [];
    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      onDrainProjectQueue: async (projectId) => {
        drained.push(projectId);
      },
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/internal/projects/p1/queue/drain`, {
      method: "POST",
      headers: { authorization: "Bearer broker-secret" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(drained).toEqual(["p1"]);
  });

  it("returns JSON 500 when an internal queue drain hook throws", async () => {
    process.env.BROKER_TOKEN = "broker-secret";
    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      onDrainProjectQueue: async () => {
        throw new Error("drain failed");
      },
    });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 500);

    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/internal/projects/p1/queue/drain`, {
        method: "POST",
        headers: { authorization: "Bearer broker-secret" },
        signal: abort.signal,
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      clearTimeout(timer);
    }
  });

  it("calls the run cancel hook for valid internal requests", async () => {
    process.env.BROKER_TOKEN = "broker-secret";
    const canceled: Array<{ projectId: string; runId: string }> = [];
    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      onCancelProjectRun: async (projectId, runId) => {
        canceled.push({ projectId, runId });
      },
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/internal/projects/p1/runs/run-1/cancel`, {
      method: "POST",
      headers: { authorization: "Bearer broker-secret" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(canceled).toEqual([{ projectId: "p1", runId: "run-1" }]);
  });
});
