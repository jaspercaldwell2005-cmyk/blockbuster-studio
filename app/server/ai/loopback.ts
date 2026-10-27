// Loopback translation for LLM endpoints.
//
// Inside the studio container, `127.0.0.1`/`localhost` point at the container itself, not at the
// machine running Docker. Users naturally type the host address they use in their browser, so when
// the server runs in a container we translate those loopback names to `host.docker.internal`
// (mapped by `make container-up` via `--add-host=host.docker.internal:host-gateway`).
//
// The rewrite is applied when the endpoint is resolved, never to the stored settings: the Settings
// page keeps showing what the user typed, and the resolution result reports the address actually
// called. Set `STUDIO_LLM_LOOPBACK_ALIAS` to another hostname, or to an empty string to disable it.

import { existsSync } from 'node:fs';

export const DEFAULT_CONTAINER_LOOPBACK_ALIAS = 'host.docker.internal';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** True when this process runs inside a Docker/Podman container. */
export function isContainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.STUDIO_LLM_IN_CONTAINER?.trim();
  if (override === '0') return false;
  if (override === '1') return true;
  // `container` is set by Podman; the marker files cover Docker and Podman without an env var.
  return Boolean(env.container) || existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

/** The host a container should call to reach the Docker host, or '' when translation is disabled. */
export function containerLoopbackAlias(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.STUDIO_LLM_LOOPBACK_ALIAS;
  return (configured === undefined ? DEFAULT_CONTAINER_LOOPBACK_ALIAS : configured).trim();
}

/** Translate a loopback base URL (keeping port, path and scheme) when running in a container. */
export function rewriteLoopbackBaseUrl(
  baseUrl: string,
  options: { inContainer?: boolean; alias?: string } = {},
): string {
  const inContainer = options.inContainer ?? isContainerRuntime();
  const alias = options.alias ?? containerLoopbackAlias();
  if (!baseUrl || !inContainer || !alias) return baseUrl;

  try {
    const url = new URL(baseUrl);
    if (!isLoopbackHost(url.hostname)) return baseUrl;
    url.hostname = alias;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl;
  }
}
