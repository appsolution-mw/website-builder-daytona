/** Shape returned by a successful sandbox spawn. */
export interface SandboxInfo {
  sandboxId: string;
  /** WSS URL that the ws-proxy will connect to — typically wss://4000-... */
  brokerUrl: string;
  /** Token the ws-proxy must include when opening the broker WS (may be empty if sandbox is public). */
  brokerPreviewToken: string;
  /** HTTPS URL the browser loads into an iframe as the project preview. */
  previewUrl: string;
}

export type SandboxStatus =
  | "provisioning"
  | "running"
  | "stopped"
  | "destroyed"
  | "error";

export interface DaytonaClient {
  spawnProjectSandbox(args: {
    projectId: string;
    cloneToken: string;
    repoOwner: string;
    repoName: string;
  }): Promise<SandboxInfo>;

  destroyProjectSandbox(sandboxId: string): Promise<void>;

  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
}
