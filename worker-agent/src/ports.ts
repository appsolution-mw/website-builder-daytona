import * as net from "node:net";

export interface PortRange {
  min: number;
  max: number;
  exclude?: Set<number>;
}

export async function pickFreePort(range: PortRange): Promise<number> {
  const exclude = range.exclude ?? new Set<number>();
  const candidates: number[] = [];
  for (let p = range.min; p <= range.max; p++) {
    if (!exclude.has(p)) candidates.push(p);
  }
  // shuffle so concurrent picks don't collide on min
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const port of candidates) {
    if (await isFree(port)) return port;
  }
  throw new Error(`Port range ${range.min}-${range.max} exhausted`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
