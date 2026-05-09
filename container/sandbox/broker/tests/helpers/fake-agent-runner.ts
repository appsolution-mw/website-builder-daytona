import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BrokerToHost } from "@wbd/protocol";

export interface FakeAgentRunnerOptions {
  /** Optional delay before flushing the scripted events. Useful for fs-tracker tests. */
  writeDelayMs?: number;
  /**
   * Delay between writing the scripted events and ending the response. Lets
   * tests observe broker side-effects (fs tracker, etc.) while the run is
   * still active.
   */
  closeDelayMs?: number;
  /** Override the response status. Defaults to 200. */
  statusCode?: number;
  /**
   * Optional event flushed immediately before the response is ended. Combine
   * with `closeDelayMs` to keep the response open between the initial events
   * and the terminal one (lets tests observe broker side-effects mid-run).
   */
  finalEvent?: BrokerToHost;
}

export interface FakeAgentRunnerHandle {
  url: string;
  close: () => Promise<void>;
  /** Captured request bodies, one per `/claude-sdk/turn` call. */
  requests: Array<{ body: string; headers: http.IncomingHttpHeaders }>;
}

/**
 * Spin up a localhost HTTP server that mimics the agent-runner's
 * `/claude-sdk/turn` endpoint. Each call returns the supplied scripted events
 * as NDJSON.
 */
export async function startFakeAgentRunner(
  events: BrokerToHost[],
  options: FakeAgentRunnerOptions = {},
): Promise<FakeAgentRunnerHandle> {
  const requests: FakeAgentRunnerHandle["requests"] = [];
  const status = options.statusCode ?? 200;
  const writeDelayMs = options.writeDelayMs ?? 0;
  const closeDelayMs = options.closeDelayMs ?? 0;

  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
    });
    req.on("end", () => {
      requests.push({ body: buf, headers: req.headers });
      if (status !== 200) {
        res.writeHead(status);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const writeEvents = () => {
        for (const e of events) res.write(`${JSON.stringify(e)}\n`);
      };
      const finish = () => {
        const closeNow = () => {
          if (options.finalEvent) {
            res.write(`${JSON.stringify(options.finalEvent)}\n`);
          }
          res.end();
        };
        if (closeDelayMs > 0) {
          setTimeout(closeNow, closeDelayMs);
        } else {
          closeNow();
        }
      };
      if (writeDelayMs > 0) {
        setTimeout(() => {
          writeEvents();
          finish();
        }, writeDelayMs);
      } else {
        writeEvents();
        finish();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
