export interface RenderWorkerCloudInitArgs {
  workerId: string;
  workerAgentImage: string;
  workerAgentHmacSecret: string;
  tailscaleAuthKey: string;
  heartbeatUrl: string;
  sandboxImage: string;
  imageRegistryAuth?: {
    registry: string;
    username: string;
    token: string;
  };
}

const SAFE_SHELL_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/;
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F\u0085\u2028\u2029]/;

function assertCloudInitValue(name: string, value: string): void {
  if (CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
}

function yaml(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shell(value: string): string {
  if (SAFE_SHELL_WORD.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function renderWorkerCloudInit(args: RenderWorkerCloudInitArgs): string {
  assertCloudInitValue("workerId", args.workerId);
  assertCloudInitValue("workerAgentImage", args.workerAgentImage);
  assertCloudInitValue("workerAgentHmacSecret", args.workerAgentHmacSecret);
  assertCloudInitValue("tailscaleAuthKey", args.tailscaleAuthKey);
  assertCloudInitValue("heartbeatUrl", args.heartbeatUrl);
  assertCloudInitValue("sandboxImage", args.sandboxImage);
  if (args.imageRegistryAuth) {
    assertCloudInitValue("imageRegistryAuth.registry", args.imageRegistryAuth.registry);
    assertCloudInitValue("imageRegistryAuth.username", args.imageRegistryAuth.username);
    assertCloudInitValue("imageRegistryAuth.token", args.imageRegistryAuth.token);
  }

  const workerId = shell(args.workerId);
  const workerAgentImage = shell(args.workerAgentImage);
  const workerAgentHmacSecret = shell(args.workerAgentHmacSecret);
  const tailscaleAuthKey = shell(args.tailscaleAuthKey);
  const heartbeatUrl = shell(args.heartbeatUrl);
  const sandboxImage = shell(args.sandboxImage);
  const dockerRunCommand = [
    "docker run -d --name worker-agent --restart unless-stopped",
    "-p 4500:4500",
    "-v /var/run/docker.sock:/var/run/docker.sock",
    `-e WORKER_ID=${workerId}`,
    `-e HMAC_SECRET=${workerAgentHmacSecret}`,
    `-e HOST_URL=${heartbeatUrl}`,
    `-e SANDBOX_IMAGE=${sandboxImage}`,
    workerAgentImage,
  ].join(" ");

  const dockerLoginLine = args.imageRegistryAuth
    ? `  - ${yaml(
        `docker login ${shell(args.imageRegistryAuth.registry)} -u ${shell(args.imageRegistryAuth.username)} -p ${shell(args.imageRegistryAuth.token)}`,
      )}\n`
    : "";

  return `#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - docker.io

runcmd:
  - ${yaml("systemctl enable --now docker")}
  - ${yaml("curl -fsSL https://tailscale.com/install.sh | sh")}
  - ${yaml("systemctl enable --now tailscaled")}
  - ${yaml(`tailscale up --auth-key ${tailscaleAuthKey}`)}
${dockerLoginLine}  - ${yaml(`docker pull ${workerAgentImage}`)}
  - ${yaml(`docker pull ${sandboxImage}`)}
  - ${yaml("docker rm -f worker-agent || true")}
  - ${yaml(dockerRunCommand)}
`;
}

export function redactCloudInit(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const yamlCommand = parseYamlCommandLine(line);

      if (yamlCommand) {
        return `${yamlCommand.prefix}${yaml(redactCommandSecrets(yamlCommand.command))}${yamlCommand.suffix}`;
      }

      return redactCommandSecrets(line);
    })
    .join("\n");
}

function parseYamlCommandLine(
  line: string,
): { prefix: string; command: string; suffix: string } | null {
  const match = line.match(/^(\s*-\s*)'(.*)'(\s*)$/);

  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    command: match[2].replace(/''/g, "'"),
    suffix: match[3],
  };
}

function redactCommandSecrets(command: string): string {
  let redacted = redactShellTokenAfter(command, "tailscale up --auth-key ");
  redacted = redactShellTokenAfter(redacted, "HMAC_SECRET=");
  if (redacted.startsWith("docker login ")) {
    redacted = redactShellTokenAfter(redacted, " -p ");
  }
  return redacted;
}

function redactShellTokenAfter(value: string, marker: string): string {
  const start = value.indexOf(marker);

  if (start === -1) {
    return value;
  }

  const valueStart = start + marker.length;
  const valueEnd = findShellTokenEnd(value, valueStart);

  return `${value.slice(0, valueStart)}[REDACTED]${value.slice(valueEnd)}`;
}

function findShellTokenEnd(value: string, start: number): number {
  if (value[start] !== "'") {
    let index = start;

    while (index < value.length && !/\s/.test(value[index])) {
      index += 1;
    }

    return index;
  }

  let index = start + 1;

  while (index < value.length) {
    const quoteIndex = value.indexOf("'", index);

    if (quoteIndex === -1) {
      return value.length;
    }

    if (value.slice(quoteIndex, quoteIndex + 4) === "'\\''") {
      index = quoteIndex + 4;
      continue;
    }

    return quoteIndex + 1;
  }

  return value.length;
}
