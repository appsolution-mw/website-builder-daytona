import { describe, expect, it } from "vitest";
import { libraryPresetItemIdForRuntimeSync } from "@/lib/agents/openhands-library-snapshot";

describe("libraryPresetItemIdForRuntimeSync", () => {
  it("omits the preset id when the selected preset already has a snapshot", () => {
    expect(
      libraryPresetItemIdForRuntimeSync({
        selectedLibraryPresetId: "preset-1",
        librarySnapshot: { presetItemId: "preset-1" },
      }),
    ).toBeUndefined();
  });

  it("returns the preset id when no snapshot exists yet", () => {
    expect(
      libraryPresetItemIdForRuntimeSync({
        selectedLibraryPresetId: "preset-1",
      }),
    ).toBe("preset-1");
  });

  it("returns the preset id when the selection differs from the snapshot", () => {
    expect(
      libraryPresetItemIdForRuntimeSync({
        selectedLibraryPresetId: "preset-2",
        librarySnapshot: { presetItemId: "preset-1" },
      }),
    ).toBe("preset-2");
  });
});
