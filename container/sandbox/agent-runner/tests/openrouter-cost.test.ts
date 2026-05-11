import { describe, it, expect, vi } from "vitest";
import {
  fetchOpenRouterCosts,
  fetchOpenRouterGenerationCost,
} from "../src/openrouter-cost.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchOpenRouterGenerationCost", () => {
  it("returns parsed cost + tokens on 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: "gen-1",
          total_cost: 0.0234,
          native_tokens_prompt: 1500,
          native_tokens_completion: 250,
        },
      }),
    );
    const res = await fetchOpenRouterGenerationCost("gen-1", {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res).toEqual({
      generationId: "gen-1",
      totalCost: 0.0234,
      promptTokens: 1500,
      completionTokens: 250,
      ok: true,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/generation?id=gen-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer key",
        }),
      }),
    );
  });

  it("returns ok:false on 404", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const res = await fetchOpenRouterGenerationCost("gen-2", {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res).toEqual({
      generationId: "gen-2",
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      ok: false,
    });
  });

  it("returns ok:false on 5xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));
    const res = await fetchOpenRouterGenerationCost("gen-3", {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.totalCost).toBe(0);
  });

  it("returns ok:false when fetch throws (e.g. network error)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    const res = await fetchOpenRouterGenerationCost("gen-4", {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.totalCost).toBe(0);
  });

  it("returns ok:false when response body is missing data field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "no data" }));
    const res = await fetchOpenRouterGenerationCost("gen-5", {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(false);
  });
});

describe("fetchOpenRouterCosts (aggregate)", () => {
  it("returns zero aggregate when generationIds is empty", async () => {
    const res = await fetchOpenRouterCosts([], {
      openrouterApiKey: "key",
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    expect(res).toEqual({
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      attempted: 0,
      succeeded: 0,
    });
  });

  it("aggregates two successful lookups", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "a", total_cost: 0.01, native_tokens_prompt: 100, native_tokens_completion: 50 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "b", total_cost: 0.02, native_tokens_prompt: 200, native_tokens_completion: 75 },
        }),
      );
    const res = await fetchOpenRouterCosts(["a", "b"], {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res).toEqual({
      totalCost: 0.03,
      promptTokens: 300,
      completionTokens: 125,
      attempted: 2,
      succeeded: 2,
    });
  });

  it("two ok + one fail: aggregate counts 2 successes; cost is sum of 2", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "a", total_cost: 0.01, native_tokens_prompt: 100, native_tokens_completion: 50 },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "c", total_cost: 0.02, native_tokens_prompt: 200, native_tokens_completion: 75 },
        }),
      );
    const res = await fetchOpenRouterCosts(["a", "b", "c"], {
      openrouterApiKey: "key",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    expect(res).toEqual({
      totalCost: 0.03,
      promptTokens: 300,
      completionTokens: 125,
      attempted: 3,
      succeeded: 2,
    });
  });
});
