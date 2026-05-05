import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET as listLibrary, POST as createLibrary } from "../route";
import { PATCH as updateLibraryItem } from "../[itemId]/route";
import { POST as rollbackLibrary } from "../[itemId]/rollback/route";
import { POST as publishRevision } from "../[itemId]/revisions/route";

const userId = "library-api-user";
const originalDevUserId = process.env.DEV_USER_ID;

const skillConfig = {
  description: "SEO skill",
  triggers: ["seo"],
  allowDynamicCommands: false,
} satisfies Prisma.InputJsonObject;

beforeEach(async (): Promise<void> => {
  process.env.DEV_USER_ID = userId;
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.libraryRevision.deleteMany({});
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({ data: { id: userId, email: "library-api@example.com" } });
});

afterAll((): void => {
  if (originalDevUserId === undefined) {
    delete process.env.DEV_USER_ID;
    return;
  }
  process.env.DEV_USER_ID = originalDevUserId;
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function patchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("library API", () => {
  it("creates and lists library items for the dev user", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "nextjs-seo",
      name: "Next.js SEO",
      description: "SEO skill",
      tags: ["nextjs"],
    }));
    expect(createResponse.status).toBe(201);

    const listResponse = await listLibrary(new Request("http://test.local/api/library"));
    const body = await listResponse.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ slug: "nextjs-seo", type: "SKILL" });
  });

  it("rejects invalid item type", async (): Promise<void> => {
    const response = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "BAD",
      slug: "bad",
      name: "Bad",
    }));

    expect(response.status).toBe(400);
  });

  it("publishes a revision for an owned item", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "publishable-skill",
      name: "Publishable Skill",
      description: "",
      tags: [],
    }));
    const createBody = await createResponse.json();

    const publishResponse = await publishRevision(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/revisions`, {
        title: "Initial",
        content: "Use metadata.",
        configJson: skillConfig,
        changeNote: "first",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );
    const publishBody = await publishResponse.json();

    expect(publishResponse.status).toBe(201);
    expect(publishBody.revision).toMatchObject({
      itemId: createBody.item.id,
      version: 1,
      title: "Initial",
    });
  });

  it("rejects publishing through generic item status PATCH", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "draft-skill",
      name: "Draft Skill",
      description: "",
      tags: [],
    }));
    const createBody = await createResponse.json();

    const response = await updateLibraryItem(
      patchRequest(`http://test.local/api/library/${createBody.item.id}`, {
        status: "PUBLISHED",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    expect(response.status).toBe(409);
  });

  it("rejects unarchiving through generic item status PATCH", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "archived-skill",
      name: "Archived Skill",
      description: "",
      tags: [],
    }));
    const createBody = await createResponse.json();
    await updateLibraryItem(
      patchRequest(`http://test.local/api/library/${createBody.item.id}`, {
        status: "ARCHIVED",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    const response = await updateLibraryItem(
      patchRequest(`http://test.local/api/library/${createBody.item.id}`, {
        status: "DRAFT",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    expect(response.status).toBe(409);
  });

  it("rolls back an owned item as a new revision", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "rollback-skill",
      name: "Rollback Skill",
      description: "",
      tags: [],
    }));
    const createBody = await createResponse.json();
    const firstResponse = await publishRevision(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/revisions`, {
        title: "Initial",
        content: "v1",
        configJson: skillConfig,
        changeNote: "first",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );
    const firstBody = await firstResponse.json();
    await publishRevision(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/revisions`, {
        title: "Second",
        content: "v2",
        configJson: skillConfig,
        changeNote: "second",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    const rollbackResponse = await rollbackLibrary(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/rollback`, {
        revisionId: firstBody.revision.id,
        changeNote: "rollback to v1",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );
    const rollbackBody = await rollbackResponse.json();

    expect(rollbackResponse.status).toBe(201);
    expect(rollbackBody.revision).toMatchObject({
      itemId: createBody.item.id,
      version: 3,
      content: "v1",
    });
  });

  it("returns conflict when publishing or rolling back an archived item", async (): Promise<void> => {
    const createResponse = await createLibrary(jsonRequest("http://test.local/api/library", {
      type: "SKILL",
      slug: "archived-publish-skill",
      name: "Archived Publish Skill",
      description: "",
      tags: [],
    }));
    const createBody = await createResponse.json();
    const firstResponse = await publishRevision(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/revisions`, {
        title: "Initial",
        content: "v1",
        configJson: skillConfig,
        changeNote: "first",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );
    const firstBody = await firstResponse.json();
    await updateLibraryItem(
      patchRequest(`http://test.local/api/library/${createBody.item.id}`, {
        status: "ARCHIVED",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    const publishResponse = await publishRevision(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/revisions`, {
        title: "Second",
        content: "v2",
        configJson: skillConfig,
        changeNote: "second",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );
    const rollbackResponse = await rollbackLibrary(
      jsonRequest(`http://test.local/api/library/${createBody.item.id}/rollback`, {
        revisionId: firstBody.revision.id,
        changeNote: "rollback",
      }),
      { params: Promise.resolve({ itemId: createBody.item.id }) },
    );

    expect(publishResponse.status).toBe(409);
    expect(rollbackResponse.status).toBe(409);
  });
});
