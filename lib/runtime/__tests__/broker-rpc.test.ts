import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrokerRpcError,
  brokerGetCommitDiff,
  brokerGetCommitFiles,
  brokerJsonRpc,
} from "../broker-rpc";

describe("brokerJsonRpc", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("converts a wss broker URL to https + sets bearer header and preserves query params", async () => {
    const captured: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await brokerJsonRpc(
      { brokerUrl: "wss://broker.example?token=broker-token", brokerPreviewToken: "broker-token" },
      "/git/commit-files",
      { sha: "a".repeat(40) },
    );

    expect(captured.length).toBe(1);
    expect(captured[0]!.url.startsWith("https://broker.example/internal/projects/host/git/commit-files")).toBe(true);
    expect(captured[0]!.url).toContain("token=broker-token");
    const headers = captured[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer broker-token");
    expect(captured[0]!.init?.method).toBe("POST");
  });

  it("converts a ws broker URL with port to http + bearer", async () => {
    const captured: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await brokerJsonRpc(
      { brokerUrl: "ws://10.0.0.5:33001/?token=broker-token", brokerPreviewToken: "broker-token" },
      "/git/commit-diff",
      { sha: "a".repeat(40), path: "a.txt" },
    );

    expect(captured[0]!.url.startsWith("http://10.0.0.5:33001/internal/projects/host/git/commit-diff")).toBe(true);
    const headers = captured[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer broker-token");
  });

  it("throws BrokerRpcError on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "bad-request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await expect(
      brokerJsonRpc(
        { brokerUrl: "ws://127.0.0.1:1/?token=t", brokerPreviewToken: "t" },
        "/git/commit-files",
        { sha: "x" },
      ),
    ).rejects.toBeInstanceOf(BrokerRpcError);
  });

  it("aborts and throws BrokerRpcError when broker exceeds the timeout", async () => {
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }) as typeof globalThis.fetch;

    await expect(
      brokerJsonRpc(
        { brokerUrl: "wss://broker.example/api", brokerPreviewToken: null },
        "/git/commit-files",
        { sha: "0".repeat(40) },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out/);
  });
});

describe("brokerGetCommitFiles + brokerGetCommitDiff", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("brokerGetCommitFiles posts {sha} and returns the parsed body", async () => {
    let receivedBody = "";
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      receivedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ files: [{ path: "a.txt", insertions: 1, deletions: 0 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await brokerGetCommitFiles(
      { brokerUrl: "ws://127.0.0.1:1/?token=t", brokerPreviewToken: "t" },
      "a".repeat(40),
    );
    expect(result.files).toEqual([{ path: "a.txt", insertions: 1, deletions: 0 }]);
    expect(JSON.parse(receivedBody)).toEqual({ sha: "a".repeat(40) });
  });

  it("brokerGetCommitDiff posts {sha,path} and returns the parsed body", async () => {
    let receivedBody = "";
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      receivedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ diff: "+hello" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await brokerGetCommitDiff(
      { brokerUrl: "ws://127.0.0.1:1/?token=t", brokerPreviewToken: "t" },
      "a".repeat(40),
      "a.txt",
    );
    expect(result.diff).toBe("+hello");
    expect(JSON.parse(receivedBody)).toEqual({ sha: "a".repeat(40), path: "a.txt" });
  });
});
