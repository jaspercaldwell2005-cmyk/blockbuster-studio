// OpenAI-compatible LLM endpoints: resolve the stored host/port config, discover the models a
// server lists at `/v1/models`, and make one small chat call to check the connection.
//
// Unsloth serves models through llama.cpp's OpenAI-compatible server, which exposes /v1/models,
// so the Settings UI can offer a model picker instead of asking for an id by hand.

import { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } from '../config';
import { getStoredSettings } from '../settings';
import { buildOpenAiBaseUrl, normalizeOpenAiBaseUrl } from '../../shared/llm';
import { rewriteLoopbackBaseUrl } from './loopback';

export interface OpenAiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAiEndpointOverrides {
  baseUrl?: string;
  host?: string;
  port?: string;
  apiKey?: string;
  model?: string;
}

/** Stored settings (DB) with env fallbacks; overrides let the Settings page test unsaved values. */
export function resolveOpenAiEndpoint(overrides: OpenAiEndpointOverrides = {}): OpenAiEndpoint {
  const stored = getStoredSettings();

  let baseUrl = overrides.baseUrl?.trim() || '';
  if (!baseUrl && (overrides.host?.trim() || overrides.port?.trim())) {
    const host = overrides.host?.trim() || '';
    const port = overrides.port?.trim() || '';
    if (host) baseUrl = buildOpenAiBaseUrl({ protocol: 'http', host, port, path: '/v1' });
  }
  if (!baseUrl) baseUrl = normalizeOpenAiBaseUrl(stored.openaiBaseUrl);
  if (!baseUrl) {
    const host = stored.openaiHost?.trim() || '';
    const port = stored.openaiPort?.trim() || '';
    if (host) baseUrl = buildOpenAiBaseUrl({ protocol: 'http', host, port, path: '/v1' });
  }
  if (!baseUrl) baseUrl = normalizeOpenAiBaseUrl(OPENAI_BASE_URL);

  return {
    // A container can't reach the host through 127.0.0.1; call host.docker.internal instead.
    baseUrl: rewriteLoopbackBaseUrl(baseUrl),
    apiKey: overrides.apiKey?.trim() || stored.openaiApiKey || OPENAI_API_KEY || '',
    model: overrides.model?.trim() || stored.openaiModel || OPENAI_MODEL || '',
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Local llama.cpp servers usually ignore the token; only send one when the user set it.
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function responseError(status: number, body: string): Error {
  const detail = body.trim().slice(0, 500);
  return new Error(`OpenAI-compatible server returned ${status}${detail ? `: ${detail}` : ''}`);
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
  return `${err.message}${cause}`;
}

/** Model ids from the OpenAI shape (`data[].id`) or llama.cpp's looser variants, plus loaded flags. */
function modelList(body: unknown): { models: string[]; loadedModels: string[] } {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((body as { data?: unknown; models?: unknown }).data ?? (body as { models?: unknown }).models ?? [])
      : [];
  if (!Array.isArray(list)) return { models: [], loadedModels: [] };

  const entries = list
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, loaded: false };
      if (!entry || typeof entry !== 'object') return undefined;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== 'string') return undefined;
      return { id, loaded: (entry as { loaded?: unknown }).loaded === true };
    })
    .filter((entry): entry is { id: string; loaded: boolean } => Boolean(entry?.id.trim()))
    .map((entry) => ({ id: entry.id.trim(), loaded: entry.loaded }));

  const ids = [...new Set(entries.map((entry) => entry.id))].sort((a, b) => a.localeCompare(b));
  const loaded = [...new Set(entries.filter((entry) => entry.loaded).map((entry) => entry.id))].sort((a, b) => a.localeCompare(b));
  return { models: ids, loadedModels: loaded };
}

function messageText(body: unknown): string {
  const choices = (body as { choices?: unknown })?.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!first || typeof first !== 'object') return '';
  const message = (first as { message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => (part && typeof part === 'object' ? (part as { text?: unknown }).text : undefined))
      .filter((text): text is string => typeof text === 'string')
      .join('');
    if (parts.trim()) return parts;
  }
  const text = (first as { text?: unknown }).text;
  if (typeof text === 'string' && text.trim()) return text;
  // Reasoning models can spend the whole tiny test budget on reasoning_content and leave content
  // empty. Any text in the reply still proves the endpoint, key and model work.
  const reasoning = message?.reasoning_content ?? message?.reasoning;
  return typeof reasoning === 'string' ? reasoning : '';
}

/** Ask the server which models it can run. Throws a readable error when it can't be reached. */
export async function listOpenAiModels(
  endpoint: Pick<OpenAiEndpoint, 'baseUrl' | 'apiKey'>,
  timeoutMs = 15_000,
): Promise<{ baseUrl: string; models: string[]; loadedModels: string[] }> {
  if (!endpoint.baseUrl) throw new Error('Add the LLM host and port first');

  let res: Response;
  try {
    res = await fetch(`${endpoint.baseUrl}/models`, {
      headers: authHeaders(endpoint.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Could not reach ${endpoint.baseUrl}/models: ${errorMessage(err)}`);
  }

  if (!res.ok) throw responseError(res.status, await res.text().catch(() => ''));

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('The LLM server returned a non-JSON model list');
  }

  const { models, loadedModels } = modelList(body);
  if (models.length === 0) throw new Error('The LLM server answered, but listed no models');
  return { baseUrl: endpoint.baseUrl, models, loadedModels };
}

/** Send one tiny chat completion to prove the URL, key and model work together. */
export async function testOpenAiConnection(
  endpoint: OpenAiEndpoint,
  timeoutMs = 90_000,
): Promise<{ baseUrl: string; model: string; latencyMs: number; reply: string }> {
  if (!endpoint.baseUrl) throw new Error('Add the LLM host and port first');
  if (!endpoint.model) throw new Error('Choose an LLM model first');

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(endpoint.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: endpoint.model,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach ${endpoint.baseUrl}/chat/completions: ${errorMessage(err)}`);
  }

  if (!res.ok) throw responseError(res.status, await res.text().catch(() => ''));

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('The LLM server returned a non-JSON chat response');
  }

  const reply = messageText(body).trim();
  if (!reply) throw new Error('The LLM server answered, but the reply had no text');

  return { baseUrl: endpoint.baseUrl, model: endpoint.model, latencyMs: Date.now() - started, reply: reply.slice(0, 200) };
}
