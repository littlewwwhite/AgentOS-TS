// input: browser protocol + host
// output: websocket endpoint URL for the console backend
// pos: keeps browser runtime URL construction deployable behind reverse proxies

export function resolveWsUrl(protocol: string, host: string): string {
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const [hostname, port] = host.split(":");
  if (protocol === "http:" && port === "5173" && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return `${wsProtocol}://${hostname}:3001/ws`;
  }
  return `${wsProtocol}://${host}/ws`;
}
