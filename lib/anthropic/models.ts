import type { OpenRouterModelOption } from "@/lib/openrouter/models";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_CONTEXT = 200_000;
const ONE_M_CONTEXT = 1_000_000;

// Model families that support the [1m] extended-context tier. The CLI /
// REST API accepts an `[1m]` suffix on the model id to switch into the
// 1M-token tier; we surface those as separate picker entries because the
// `/v1/models` catalog does not list them.
const ONE_M_FAMILIES = [/^claude-opus-4/, /^claude-sonnet-4/];

type RawAnthropicModel = {
  type?: unknown;
  id?: unknown;
  display_name?: unknown;
  created_at?: unknown;
};

type RawAnthropicResponse = {
  data?: unknown;
  has_more?: unknown;
  last_id?: unknown;
};

function supports1MContext(modelId: string): boolean {
  return ONE_M_FAMILIES.some((re) => re.test(modelId));
}

export function normalizeAnthropicModels(
  payload: RawAnthropicResponse,
): OpenRouterModelOption[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const models: OpenRouterModelOption[] = [];

  for (const row of rows) {
    const model = row as RawAnthropicModel;
    if (typeof model.id !== "string" || typeof model.display_name !== "string") continue;

    if (supports1MContext(model.id)) {
      models.push({
        id: `${model.id}[1m]`,
        label: `${model.display_name} (1M)`,
        contextLength: ONE_M_CONTEXT,
        promptPrice: null,
        completionPrice: null,
        supportedParameters: ["tools"],
        inputModalities: ["text", "image"],
      });
    }

    models.push({
      id: model.id,
      label: `${model.display_name} (200k)`,
      contextLength: DEFAULT_CONTEXT,
      promptPrice: null,
      completionPrice: null,
      supportedParameters: ["tools"],
      inputModalities: ["text", "image"],
    });
  }

  return models;
}

export async function fetchAnthropicModels(apiKey: string): Promise<OpenRouterModelOption[]> {
  const url = new URL(ANTHROPIC_MODELS_URL);
  url.searchParams.set("limit", "1000");

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
  });

  if (!res.ok) {
    throw new Error(`Anthropic models request failed: HTTP ${res.status}`);
  }

  const payload = (await res.json()) as RawAnthropicResponse;
  return normalizeAnthropicModels(payload);
}
