export type OpenRouterModelOption = {
  id: string;
  label: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
  inputModalities: string[];
};

type RawOpenRouterModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  supported_parameters?: unknown;
};

type RawOpenRouterResponse = {
  data?: unknown;
};

const MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeOpenRouterModels(payload: RawOpenRouterResponse): OpenRouterModelOption[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];

  return rows
    .flatMap((row): OpenRouterModelOption[] => {
      const model = row as RawOpenRouterModel;
      if (typeof model.id !== "string" || typeof model.name !== "string") {
        return [];
      }

      const inputModalities = stringArray(model.architecture?.input_modalities);
      const outputModalities = stringArray(model.architecture?.output_modalities);
      const supportedParameters = stringArray(model.supported_parameters);
      if (
        !outputModalities.includes("text") ||
        !supportedParameters.includes("tools") ||
        !inputModalities.includes("text") ||
        !inputModalities.includes("image")
      ) {
        return [];
      }

      return [
        {
          id: `openrouter:${model.id}`,
          label: model.name,
          contextLength: typeof model.context_length === "number" ? model.context_length : 0,
          promptPrice: nullableString(model.pricing?.prompt),
          completionPrice: nullableString(model.pricing?.completion),
          supportedParameters,
          inputModalities,
        },
      ];
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function fetchOpenRouterModels(
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterModelOption[]> {
  const response = await fetchImpl(MODELS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RawOpenRouterResponse;
  return normalizeOpenRouterModels(payload);
}
