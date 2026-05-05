export function localHttpUrlForBrowserPort(port: number, browserHostname?: string): string {
  const hostname = browserHostname?.trim() || "127.0.0.1";
  return `http://${hostname}:${port}`;
}
