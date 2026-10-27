// Relay a loopback-only LLM from the WSL2 host into Docker.
//
// With WSL2 mirrored networking, a Windows app listening on 127.0.0.1:8888 is reachable from WSL
// through 127.0.0.1, but not from a Docker container: the container's `host.docker.internal` points
// at the WSL VM (172.17.0.1), not at Windows. Port 8888 also can't be rebound in WSL while Windows
// owns it. This small HTTP proxy solves both: it listens on another port (default 8889) and rewrites
// the Host header, which Unsloth Studio checks.
//
// Run it with `make llm-relay`, then use that relay port in Settings → AI provider.

import http from 'node:http';

const relayHost = process.env.LLM_RELAY_HOST?.trim() || '0.0.0.0';
const relayPort = Number(process.env.LLM_RELAY_PORT || 8889);
const targetHost = process.env.LLM_TARGET_HOST?.trim() || '127.0.0.1';
const targetPort = Number(process.env.LLM_TARGET_PORT || 8888);
const targetAuthority = `${targetHost}:${targetPort}`;

if (!Number.isInteger(relayPort) || relayPort <= 0 || !Number.isInteger(targetPort) || targetPort <= 0) {
  console.error('LLM_RELAY_PORT and LLM_TARGET_PORT must be positive port numbers.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // Unsloth Studio only answers with its own loopback authority; keep that Host when forwarding.
  const headers = { ...req.headers, host: targetAuthority };
  const upstream = http.request(
    { host: targetHost, port: targetPort, method: req.method, path: req.url, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.setTimeout(0); // long generations and streaming replies are fine
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `LLM relay could not reach ${targetAuthority}: ${err.message}` }));
  });
  req.on('error', () => upstream.destroy());
  req.pipe(upstream);
});

server.on('error', (err) => {
  console.error(`LLM relay could not listen on ${relayHost}:${relayPort}: ${err.message}`);
  process.exit(1);
});

server.listen(relayPort, relayHost, () => {
  console.log(`LLM relay: http://${relayHost}:${relayPort} -> http://${targetAuthority} (Host header rewritten)`);
  console.log(`In Settings → AI provider, use port ${relayPort}. Stop with Ctrl-C.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
