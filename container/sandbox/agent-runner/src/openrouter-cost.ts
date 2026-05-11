export interface OpenRouterGenerationCost {
  generationId: string;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  ok: boolean;
}

export interface FetchCostsOptions {
  openrouterApiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  baseUrl?: string;
  log?: (msg: string, err?: unknown) => void;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchOpenRouterGenerationCost(
  generationId: string,
  opts: FetchCostsOptions,
): Promise<OpenRouterGenerationCost> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = opts.log ?? ((m, e) => console.warn(`[openrouter-cost] ${m}`, e ?? ""));

  const url = `${baseUrl}/generation?id=${encodeURIComponent(generationId)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { authorization: `Bearer ${opts.openrouterApiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log(`generation ${generationId} lookup returned ${res.status}`);
      return failure(generationId);
    }
    const body = (await res.json()) as { data?: unknown };
    const data = isRecord(body?.data) ? body.data : null;
    if (!data) {
      log(`generation ${generationId} response missing data`);
      return failure(generationId);
    }
    return {
      generationId,
      totalCost: numberOr0((data as Record<string, unknown>).total_cost),
      promptTokens: numberOr0((data as Record<string, unknown>).native_tokens_prompt),
      completionTokens: numberOr0((data as Record<string, unknown>).native_tokens_completion),
      ok: true,
    };
  } catch (err) {
    log(`generation ${generationId} lookup error`, err);
    return failure(generationId);
  } finally {
    clearTimeout(timer);
  }
}

export interface AggregateCost {
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  attempted: number;
  succeeded: number;
}

export async function fetchOpenRouterCosts(
  generationIds: string[],
  opts: FetchCostsOptions,
): Promise<AggregateCost> {
  if (generationIds.length === 0) {
    return { totalCost: 0, promptTokens: 0, completionTokens: 0, attempted: 0, succeeded: 0 };
  }
  const results = await Promise.all(
    generationIds.map((id) => fetchOpenRouterGenerationCost(id, opts)),
  );
  let totalCost = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let succeeded = 0;
  for (const r of results) {
    if (!r.ok) continue;
    totalCost += r.totalCost;
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    succeeded += 1;
  }
  return {
    totalCost,
    promptTokens,
    completionTokens,
    attempted: generationIds.length,
    succeeded,
  };
}

function failure(generationId: string): OpenRouterGenerationCost {
  return {
    generationId,
    totalCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    ok: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr0(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
