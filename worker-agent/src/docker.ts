import type Docker from "dockerode";
import { pickFreePort, type PortRange } from "./ports.js";

const SANDBOX_LABEL = "wbd.sandbox-id";
const PROJECT_LABEL = "wbd.project-id";

export interface SandboxSpec {
  sandboxId: string;
  projectId: string;
  image: string;
  env: Record<string, string>;
  /** Override entrypoint/command for tests. Production sandboxes use the image's ENTRYPOINT. */
  command?: string[];
  brokerContainerPort: number;     // typically 4000
  previewContainerPort: number;    // typically 3000
}

export interface CreatedSandbox {
  sandboxId: string;
  containerId: string;
  brokerPort: number;
  previewPort: number;
  status: "spawning";
}

export type SandboxStatus = "spawning" | "running" | "stopped" | "gone";

export interface SandboxStatusInfo {
  sandboxId: string;
  containerId?: string;
  brokerPort?: number;
  previewPort?: number;
  status: SandboxStatus;
}

export interface DockerClient {
  createSandbox(spec: SandboxSpec): Promise<CreatedSandbox>;
  destroySandbox(sandboxId: string): Promise<void>;
  getStatus(sandboxId: string): Promise<SandboxStatusInfo>;
  listSandboxes(): Promise<SandboxStatusInfo[]>;
}

export interface CreateDockerClientArgs {
  docker: Docker;
  portRange: PortRange;
}

export function createDockerClient({ docker, portRange }: CreateDockerClientArgs): DockerClient {
  const inFlight = new Set<number>();

  async function pickTwoFreePorts(): Promise<{ broker: number; preview: number }> {
    const dockerReserved = await reservedDockerHostPorts();
    const broker = await pickFreePort({ ...portRange, exclude: new Set([...inFlight, ...dockerReserved]) });
    inFlight.add(broker);
    try {
      const preview = await pickFreePort({
        ...portRange,
        exclude: new Set([...inFlight, ...dockerReserved]),
      });
      inFlight.add(preview);
      return { broker, preview };
    } finally {
      // Released after createContainer completes (caller scope)
    }
  }

  async function reservedDockerHostPorts(): Promise<Set<number>> {
    const reserved = new Set<number>();
    const containers = await docker.listContainers({ all: true });
    for (const container of containers) {
      for (const port of container.Ports ?? []) {
        if (typeof port.PublicPort === "number") reserved.add(port.PublicPort);
      }
    }
    return reserved;
  }

  async function findBySandboxId(sandboxId: string) {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`${SANDBOX_LABEL}=${sandboxId}`] },
    });
    return containers[0];
  }

  return {
    async createSandbox(spec: SandboxSpec): Promise<CreatedSandbox> {
      const { broker, preview } = await pickTwoFreePorts();
      try {
        const Env = Object.entries(spec.env).map(([k, v]) => `${k}=${v}`);
        const create = await docker.createContainer({
          name: `wbd-${spec.sandboxId}`,
          Image: spec.image,
          Env,
          Cmd: spec.command,
          Labels: {
            [SANDBOX_LABEL]: spec.sandboxId,
            [PROJECT_LABEL]: spec.projectId,
          },
          ExposedPorts: {
            [`${spec.brokerContainerPort}/tcp`]: {},
            [`${spec.previewContainerPort}/tcp`]: {},
          },
          HostConfig: {
            PortBindings: {
              [`${spec.brokerContainerPort}/tcp`]: [{ HostPort: String(broker) }],
              [`${spec.previewContainerPort}/tcp`]: [{ HostPort: String(preview) }],
            },
            // `unless-stopped` so a worker VM cold-reboot brings sandbox
            // containers back up automatically (matches the worker-agent and
            // watchtower restart policies). The host explicitly stops them
            // via destroyProjectSandbox; that respects "stopped by user" and
            // the policy then leaves them down.
            RestartPolicy: { Name: "unless-stopped" },
            AutoRemove: false,
          },
        });
        try {
          await create.start();
        } catch (err) {
          await create.remove({ force: true }).catch(() => {});
          throw err;
        }
        return {
          sandboxId: spec.sandboxId,
          containerId: create.id,
          brokerPort: broker,
          previewPort: preview,
          status: "spawning",
        };
      } finally {
        inFlight.delete(broker);
        inFlight.delete(preview);
      }
    },

    async destroySandbox(sandboxId: string): Promise<void> {
      const c = await findBySandboxId(sandboxId);
      if (!c) return;
      try {
        await docker.getContainer(c.Id).remove({ force: true });
      } catch (err: unknown) {
        // 404 is fine — already gone
        const code = (err as { statusCode?: number }).statusCode;
        if (code !== 404) throw err;
      }
    },

    async getStatus(sandboxId: string): Promise<SandboxStatusInfo> {
      const c = await findBySandboxId(sandboxId);
      if (!c) return { sandboxId, status: "gone" };
      const state = c.State; // 'created' | 'running' | 'exited' | 'dead' | …
      const status: SandboxStatus =
        state === "running" ? "running" :
        state === "created" ? "spawning" :
        state === "exited" || state === "dead" ? "stopped" : "spawning";
      const broker = portFromBindings(c, "4000/tcp");
      const preview = portFromBindings(c, "3000/tcp");
      return {
        sandboxId,
        containerId: c.Id,
        brokerPort: broker,
        previewPort: preview,
        status,
      };
    },

    async listSandboxes(): Promise<SandboxStatusInfo[]> {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: [SANDBOX_LABEL] },
      });
      return containers.map((c) => {
        const state = c.State;
        const status: SandboxStatus =
          state === "running" ? "running" :
          state === "created" ? "spawning" :
          state === "exited" || state === "dead" ? "stopped" : "spawning";
        return {
          sandboxId: c.Labels[SANDBOX_LABEL],
          containerId: c.Id,
          brokerPort: portFromBindings(c, "4000/tcp"),
          previewPort: portFromBindings(c, "3000/tcp"),
          status,
        };
      });
    },
  };
}

function portFromBindings(
  c: { Ports?: Array<{ PrivatePort: number; PublicPort?: number; Type: string }> },
  key: string,
): number | undefined {
  const [privatePort, type] = key.split("/");
  const m = c.Ports?.find(
    (p) => p.PrivatePort === Number(privatePort) && p.Type === type,
  );
  return m?.PublicPort;
}
