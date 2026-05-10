import type { OpenRouterModelOption } from "@/lib/openrouter/models";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

// Codex SDK / CLI accepts a narrow slice of the OpenAI model catalog; the
// generic /v1/models response otherwise returns hundreds of irrelevant
// audio/embedding/moderation models. Filter to the coding-relevant
// families that the Codex runner is known to drive.
const CODEX_MODEL_PATTERN = /^(gpt-5(?:\.\d+)?(?:-codex)?(?:-latest)?|gpt-4\.1(?:-mini|-nano)?|o3(?:-mini|-pro)?|o4(?:-mini)?)$/i;

type RawOpenAIModel = {
  id?: unknown;
  object?: unknown;
  created?: unknown;
  owned_by?: unknown;
};

type RawOpenAIResponse = {
  data?: unknown;
};

export function normalizeOpenAICodexModels(
  payload: RawOpenAIResponse,
): OpenRouterModelOption[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const models: OpenRouterModelOption[] = [];
  for (const row of rows) {
    const model = row as RawOpenAIModel;
    if (typeof model.id !== "string") continue;
    if (!CODEX_MODEL_PATTERN.test(model.id)) continue;
    models.push({
      id: model.id,
      label: model.id,
      contextLength: 0,
      promptPrice: null,
      completionPrice: null,
      supportedParameters: ["tools"],
      inputModalities: ["text"],
    });
  }

  // Sort `*-codex` variants first (they're the coding-tuned ones), then the
  // remaining models alphabetically.
  models.sort((a, b) => {
    const aCodex = /-codex/i.test(a.id) ? 0 : 1;
    const bCodex = /-codex/i.test(b.id) ? 0 : 1;
    if (aCodex !== bCodex) return aCodex - bCodex;
    return a.id.localeCompare(b.id);
  });

  return models;
}

export async function fetchOpenAICodexModels(apiKey: string): Promise<OpenRouterModelOption[]> {
  const res = await fetch(OPENAI_MODELS_URL, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI models request failed: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as RawOpenAIResponse;
  return normalizeOpenAICodexModels(payload);
}
