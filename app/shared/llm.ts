// Shared helpers for OpenAI-compatible LLM endpoints, used by the server and the Settings UI.
//
// The studio accepts either a full base URL (e.g. https://openrouter.ai/api/v1) or the
// host/port fields the Settings page shows. Both forms normalise to a base URL such as
// http://127.0.0.1:8888/v1, which the server then calls with `/models` and `/chat/completions`.

export type OpenAiProtocol = 'http' | 'https';

export interface OpenAiEndpointParts {
  protocol: OpenAiProtocol;
  host: string;
  port: string;
  /** The API prefix, usually `/v1`. */
  path: string;
}

export const DEFAULT_OPENAI_PATH = '/v1';

/** Removes trailing slashes and strips a pasted `/models` or `/chat/completions` suffix. */
function cleanPath(pathname: string): string {
  let path = pathname.trim().replace(/\/+$/, '');
  path = path.replace(/\/(chat\/completions|completions|models)$/i, '');
  return path || DEFAULT_OPENAI_PATH;
}

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

/** Parse a base URL into the editable fields the Settings page uses. */
export function parseOpenAiBaseUrl(raw: string | undefined | null): OpenAiEndpointParts {
  const fallback: OpenAiEndpointParts = { protocol: 'http', host: '', port: '', path: DEFAULT_OPENAI_PATH };
  const value = raw?.trim();
  if (!value) return fallback;

  try {
    const url = new URL(withScheme(value));
    return {
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      host: url.hostname,
      port: url.port,
      path: cleanPath(url.pathname),
    };
  } catch {
    return fallback;
  }
}

/** Build a normalised base URL from the Settings page's host/port/path fields. */
export function buildOpenAiBaseUrl(parts: OpenAiEndpointParts): string {
  let host = parts.host.trim();
  if (!host) return '';

  // Accept a pasted URL in the host field too: `host.docker.internal:8888` or a full URL.
  let protocol = parts.protocol;
  let port = parts.port.trim();
  let path = parts.path.trim() || DEFAULT_OPENAI_PATH;

  if (/^https?:\/\//i.test(host) || host.includes('/')) {
    const parsed = new URL(withScheme(host));
    protocol = parsed.protocol === 'https:' ? 'https' : 'http';
    host = parsed.hostname;
    port = port || parsed.port;
    path = cleanPath(parsed.pathname);
  }

  // A host may carry an explicit port (host.docker.internal:8888); don't duplicate it.
  const hostWithOptionalPort = host.match(/^(.+):(\d+)$/);
  if (hostWithOptionalPort) {
    host = hostWithOptionalPort[1]!;
    port = hostWithOptionalPort[2]! || port;
  }

  path = cleanPath(path);
  if (!path.startsWith('/')) path = `/${path}`;

  return `${protocol}://${host}${port ? `:${port}` : ''}${path}`.replace(/\/+$/, '');
}

/** Normalise a full base URL, appending `/v1` only when the URL has no path of its own. */
export function normalizeOpenAiBaseUrl(raw: string | undefined | null): string {
  const value = raw?.trim();
  if (!value) return '';
  return buildOpenAiBaseUrl(parseOpenAiBaseUrl(value));
}
