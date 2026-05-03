import { describe, expect, it } from "vitest";

import { serializeInstallation } from "../serializers";

describe("GitHub installation serialization", () => {
  it("serializes bigint ids and nullable timestamps for JSON", () => {
    expect(serializeInstallation({
      id: "inst_1",
      installationId: 123n,
      accountLogin: "octo",
      accountType: "User",
      accountAvatarUrl: null,
      repositorySelection: "selected",
      suspendedAt: null,
    })).toEqual({
      id: "inst_1",
      installationId: "123",
      accountLogin: "octo",
      accountType: "User",
      accountAvatarUrl: null,
      repositorySelection: "selected",
      suspendedAt: null,
    });
  });
});
