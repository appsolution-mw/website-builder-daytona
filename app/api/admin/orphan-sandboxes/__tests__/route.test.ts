import { beforeEach, describe, expect, it, vi } from "vitest";

const listSandboxes = vi.fn();
const destroySandbox = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    workerSandbox: {
      findMany,
      findUnique,
    },
  },
}));

vi.mock("@/lib/runtime/worker-pool/agent-client", () => ({
  createAgentClient: vi.fn(() => ({
    listSandboxes,
    destroySandbox,
  })),
}));

describe("/api/admin/orphan-sandboxes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.WORKER_AGENT_URL = "http://127.0.0.1:4500";
    process.env.WORKER_AGENT_HMAC_SECRET = "x".repeat(32);
  });

  it("lists worker sandboxes that have no DB WorkerSandbox row", async () => {
    findMany.mockResolvedValue([{ id: "managed-1" }]);
    listSandboxes.mockResolvedValue([
      { sandboxId: "managed-1", status: "running", brokerPort: 30001, previewPort: 30002 },
      { sandboxId: "orphan-1", status: "stopped", brokerPort: 31001, previewPort: 31002 },
    ]);

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(body.sandboxes).toEqual([
      { sandboxId: "orphan-1", status: "stopped", brokerPort: 31001, previewPort: 31002 },
    ]);
  });

  it("removes an orphan sandbox through the worker-agent", async () => {
    findUnique.mockResolvedValue(null);

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/api/admin/orphan-sandboxes", {
      method: "DELETE",
      body: JSON.stringify({ sandboxId: "orphan-1" }),
    }));

    expect(res.status).toBe(204);
    expect(destroySandbox).toHaveBeenCalledWith("orphan-1");
  });

  it("refuses to remove a sandbox that is still managed in the DB", async () => {
    findUnique.mockResolvedValue({ id: "managed-1" });

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/api/admin/orphan-sandboxes", {
      method: "DELETE",
      body: JSON.stringify({ sandboxId: "managed-1" }),
    }));

    expect(res.status).toBe(409);
    expect(destroySandbox).not.toHaveBeenCalled();
  });
});
