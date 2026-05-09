import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BrokerToHost } from "@wbd/protocol";
import { runClaudeSdkTurn } from "../src/claude-sdk-bridge";

interface CapturedRequest {
  body: string;
  headers: http.IncomingHttpHeaders;
  url: string | undefined;
}

describe("claude-sdk-bridge", () => {
  let server: http.Server;
  let port: number;
  let lastRequest: CapturedRequest | null = null;
  let scriptedEvents: BrokerToHost[] = [];
  let respondWithStatus = 200;
  let rawResponseBody: string | null = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let buf = "";
      req.on("data", (c) => {
        buf += c;
      });
      req.on("end", () => {
        lastRequest = { body: buf, headers: req.headers, url: req.url };
        if (respondWithStatus !== 200) {
          res.writeHead(respondWithStatus);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        if (rawResponseBody !== null) {
          res.write(rawResponseBody);
        } else {
          for (const e of scriptedEvents) res.write(`${JSON.stringify(e)}\n`);
        }
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    lastRequest = null;
    scriptedEvents = [];
    respondWithStatus = 200;
    rawResponseBody = null;
  });

  it("forwards events from the runner to onEvent in order", async () => {
    scriptedEvents = [
      { type: "agent.session", turnId: "t1", runtime: "claude-code", providerSessionId: "p1" },
      { type: "agent.chunk", turnId: "t1", delta: "Hello " },
      { type: "agent.chunk", turnId: "t1", delta: "world" },
      {
        type: "agent.done",
        turnId: "t1",
        durationMs: 10,
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        exitCode: 0,
      },
    ];

    const events: BrokerToHost[] = [];
    await runClaudeSdkTurn({
      runnerUrl: `http://127.0.0.1:${port}`,
      hmacSecret: "shh",
      sessionId: "s",
      providerSessionId: "p1",
      resumeRequested: false,
      prompt: "hi",
      turnId: "t1",
      onEvent: (e) => {
        events.push(e);
      },
    });

    expect(events.map((e) => e.type)).toEqual([
      "agent.session",
      "agent.chunk",
      "agent.chunk",
      "agent.done",
    ]);
    const chunkText = events
      .filter((e): e is Extract<BrokerToHost, { type: "agent.chunk" }> => e.type === "agent.chunk")
      .map((e) => e.delta)
      .join("");
    expect(chunkText).toBe("Hello world");
  });

  it("includes HMAC headers + JSON body when calling the runner", async () => {
    scriptedEvents = [
      {
        type: "agent.done",
        turnId: "t1",
        durationMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        exitCode: 0,
      },
    ];

    await runClaudeSdkTurn({
      runnerUrl: `http://127.0.0.1:${port}`,
      hmacSecret: "shh",
      sessionId: "s",
      providerSessionId: "p1",
      resumeRequested: true,
      prompt: "hi",
      turnId: "t1",
      modelId: "claude-sonnet-4-6",
      attachments: [{ name: "img.png", mimeType: "image/png", dataBase64: "ZGF0YQ==" }],
      replayContext: [{ role: "user", text: "earlier" }],
      onEvent: () => {},
    });

    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.url).toBe("/claude-sdk/turn");
    expect(typeof lastRequest!.headers["x-runner-ts"]).toBe("string");
    expect(typeof lastRequest!.headers["x-runner-sig"]).toBe("string");
    expect(lastRequest!.headers["content-type"]).toBe("application/json");

    const parsed = JSON.parse(lastRequest!.body) as Record<string, unknown>;
    expect(parsed.providerSessionId).toBe("p1");
    expect(parsed.resumeRequested).toBe(true);
    expect(parsed.prompt).toBe("hi");
    expect(parsed.turnId).toBe("t1");
    expect(parsed.modelId).toBe("claude-sonnet-4-6");
    const attachments = parsed.attachments as Array<{ dataBase64?: string }> | undefined;
    expect(attachments?.[0]?.dataBase64).toBe("ZGF0YQ==");
    const replayContext = parsed.replayContext as
      | Array<{ role: string; text: string }>
      | undefined;
    expect(replayContext?.[0]?.text).toBe("earlier");
    expect(replayContext?.[0]?.role).toBe("user");
  });

  it("throws on non-200 response", async () => {
    respondWithStatus = 500;

    await expect(
      runClaudeSdkTurn({
        runnerUrl: `http://127.0.0.1:${port}`,
        hmacSecret: "shh",
        sessionId: "s",
        providerSessionId: "p2",
        resumeRequested: false,
        prompt: "hi",
        turnId: "t",
        onEvent: () => {},
      }),
    ).rejects.toThrow(/agent-runner/);
  });

  it("ignores malformed NDJSON lines but forwards valid ones", async () => {
    rawResponseBody = [
      JSON.stringify({ type: "agent.chunk", turnId: "t1", delta: "first" }),
      "not-valid-json{",
      JSON.stringify({ type: "agent.chunk", turnId: "t1", delta: "second" }),
      "",
      JSON.stringify({
        type: "agent.done",
        turnId: "t1",
        durationMs: 1,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        exitCode: 0,
      }),
      "",
    ].join("\n");

    const events: BrokerToHost[] = [];
    await runClaudeSdkTurn({
      runnerUrl: `http://127.0.0.1:${port}`,
      hmacSecret: "shh",
      sessionId: "s",
      providerSessionId: "p3",
      resumeRequested: false,
      prompt: "hi",
      turnId: "t1",
      onEvent: (e) => {
        events.push(e);
      },
    });

    expect(events.map((e) => e.type)).toEqual(["agent.chunk", "agent.chunk", "agent.done"]);
    const deltas = events
      .filter((e): e is Extract<BrokerToHost, { type: "agent.chunk" }> => e.type === "agent.chunk")
      .map((e) => e.delta);
    expect(deltas).toEqual(["first", "second"]);
  });
});
