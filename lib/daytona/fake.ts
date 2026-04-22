import { startBroker, type BrokerHandle } from "@wbd/broker";
import type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

interface FakeSandbox {
  id: string;
  broker: BrokerHandle;
  status: SandboxStatus;
}

export function createFakeClient(): DaytonaClient {
  const sandboxes = new Map<string, FakeSandbox>();

  return {
    async spawnProjectSandbox({ projectId }): Promise<SandboxInfo> {
      const broker = await startBroker({ port: 0 });
      const id = `fake-${projectId}-${broker.port}`;
      sandboxes.set(id, { id, broker, status: "running" });
      return {
        sandboxId: id,
        brokerUrl: `ws://localhost:${broker.port}`,
        brokerPreviewToken: "",
        previewUrl: `http://localhost:${broker.port}/__fake-preview`,
      };
    },

    async destroyProjectSandbox(sandboxId: string): Promise<void> {
      const sb = sandboxes.get(sandboxId);
      if (!sb) return;
      await sb.broker.close();
      sb.status = "destroyed";
    },

    async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
      return sandboxes.get(sandboxId)?.status ?? "destroyed";
    },
  };
}
