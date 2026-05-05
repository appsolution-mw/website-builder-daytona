export interface BuildProjectPreviewRouteInput {
  hostname: string;
  targetHost: string;
  targetPort: number;
}

export interface CaddyReverseProxyUpstream {
  dial: string;
}

export interface CaddyReverseProxyHandler {
  handler: "reverse_proxy";
  upstreams: CaddyReverseProxyUpstream[];
}

export interface CaddyHostMatcher {
  host: string[];
}

export interface CaddyRoute {
  "@id"?: string;
  match: CaddyHostMatcher[];
  handle: CaddyReverseProxyHandler[];
  terminal: boolean;
}

export function buildProjectPreviewRoute({
  hostname,
  targetHost,
  targetPort,
}: BuildProjectPreviewRouteInput): CaddyRoute {
  return {
    match: [{ host: [hostname] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `${targetHost}:${targetPort}` }],
      },
    ],
    terminal: true,
  };
}
