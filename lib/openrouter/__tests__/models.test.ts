import { describe, expect, it } from "vitest";
import { normalizeOpenRouterModels } from "../models";

describe("normalizeOpenRouterModels", () => {
  it("keeps only multimodal text+image models with tool support and prefixes ids", () => {
    const models = normalizeOpenRouterModels({
      data: [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen: Qwen3 Coder (free)",
          context_length: 1048576,
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["tools", "temperature"],
        },
        {
          id: "image/model",
          name: "Image Model",
          context_length: 4096,
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["image"],
          },
          pricing: { prompt: "1", completion: "1" },
          supported_parameters: ["temperature"],
        },
      ],
    });

    expect(models).toEqual([
      {
        id: "openrouter:qwen/qwen3-coder:free",
        label: "Qwen: Qwen3 Coder (free)",
        contextLength: 1048576,
        promptPrice: "0",
        completionPrice: "0",
        supportedParameters: ["tools", "temperature"],
        inputModalities: ["text", "image"],
      },
    ]);
  });

  it("drops text-only models", () => {
    const models = normalizeOpenRouterModels({
      data: [
        {
          id: "text-only/model",
          name: "Text Only Model",
          context_length: 8192,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "1", completion: "2" },
          supported_parameters: ["tools"],
        },
      ],
    });

    expect(models).toEqual([]);
  });

  it("drops image-only models", () => {
    const models = normalizeOpenRouterModels({
      data: [
        {
          id: "image-only/model",
          name: "Image Only Model",
          context_length: 8192,
          architecture: {
            input_modalities: ["image"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "1", completion: "2" },
          supported_parameters: ["tools"],
        },
      ],
    });

    expect(models).toEqual([]);
  });

  it("sorts models by label", () => {
    const models = normalizeOpenRouterModels({
      data: [
        {
          id: "z/model",
          name: "Zulu Model",
          context_length: 8192,
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "2", completion: "3" },
          supported_parameters: ["tools"],
        },
        {
          id: "a/model",
          name: "Alpha Model",
          context_length: 4096,
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "1", completion: "2" },
          supported_parameters: ["tools"],
        },
      ],
    });

    expect(models.map((model) => model.label)).toEqual(["Alpha Model", "Zulu Model"]);
  });
});
