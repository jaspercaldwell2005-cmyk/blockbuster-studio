// Central settings resolution: DB-stored values (via `kv`) override env fallbacks from config.ts.
// Secrets (API keys/tokens) are stored in the same `kv` row as the rest of Settings but are never
// serialized back to the client — see `publicSettings()`.
import { kv } from './db';
import { markMilestone } from './milestones';
import {
  ANTHROPIC_API_KEY,
  CIVITAI_TOKEN,
  HF_TOKEN,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
} from './config';
import { buildOpenAiBaseUrl, normalizeOpenAiBaseUrl, parseOpenAiBaseUrl } from '../shared/llm';
import type { Settings, SettingsUpdate } from '../shared/types';

const KEY = 'settings';

export type StoredSettings = Partial<Settings> & {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  civitaiToken?: string;
  hfToken?: string;
  /** Bumped on every save of the HF token, even an unchanged one: docker/download_models.py retries gated
   *  downloads when it changes, so "accept the terms, then save again" retries straight away. */
  hfTokenSavedAt?: string;
};

export function getStoredSettings(): StoredSettings {
  return kv.get<StoredSettings>(KEY) ?? {};
}

export function publicSettings(): Settings {
  const s = getStoredSettings();
  const storedBaseUrl = normalizeOpenAiBaseUrl(s.openaiBaseUrl) || normalizeOpenAiBaseUrl(OPENAI_BASE_URL);
  const parsed = parseOpenAiBaseUrl(storedBaseUrl);
  const openaiHost = s.openaiHost?.trim() || parsed.host;
  const openaiPort = s.openaiPort?.trim() || parsed.port;
  return {
    llmProvider: s.llmProvider ?? (ANTHROPIC_API_KEY ? 'anthropic' : OPENAI_API_KEY || OPENAI_BASE_URL ? 'openai_compatible' : 'none'),
    anthropicModel: s.anthropicModel || 'claude-sonnet-5',
    openaiBaseUrl: storedBaseUrl || (openaiHost ? buildOpenAiBaseUrl({ protocol: 'http', host: openaiHost, port: openaiPort, path: '/v1' }) : ''),
    openaiHost,
    openaiPort,
    openaiModel: s.openaiModel || OPENAI_MODEL || '',
    opencodeModel: s.opencodeModel || '',
    anthropicApiKeySet: Boolean(s.anthropicApiKey || ANTHROPIC_API_KEY),
    openaiApiKeySet: Boolean(s.openaiApiKey || OPENAI_API_KEY),
    civitaiTokenSet: Boolean(s.civitaiToken || CIVITAI_TOKEN),
    hfTokenSet: Boolean(s.hfToken || HF_TOKEN),
  };
}

export function updateSettings(update: SettingsUpdate): Settings {
  const cur = getStoredSettings();
  const next: StoredSettings = { ...cur };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (key === 'retryHfDownloads') {
      if (value) next.hfTokenSavedAt = new Date().toISOString(); // the downloader retries when this changes
      continue;
    }
    if ((key === 'anthropicApiKey' || key === 'openaiApiKey' || key === 'civitaiToken' || key === 'hfToken') && value === '') {
      delete (next as Record<string, unknown>)[key];
    } else {
      if (key === 'hfToken' && value) {
        markMilestone('hfTokenSavedAt'); // first HF token ever saved (setup-milestones)
        next.hfTokenSavedAt = new Date().toISOString();
      }
      (next as Record<string, unknown>)[key] = value;
    }
  }

  // Keep the canonical base URL and the Settings page's host/port fields in sync. A full base URL
  // wins (it may carry https and a path such as /api/v1); host/port alone default to http + /v1.
  if (update.openaiBaseUrl !== undefined) {
    const normalized = normalizeOpenAiBaseUrl(update.openaiBaseUrl);
    if (normalized) {
      next.openaiBaseUrl = normalized;
      const parsed = parseOpenAiBaseUrl(normalized);
      next.openaiHost = parsed.host;
      next.openaiPort = parsed.port;
    } else {
      delete next.openaiBaseUrl;
      if (update.openaiHost === undefined) delete next.openaiHost;
      if (update.openaiPort === undefined) delete next.openaiPort;
    }
  } else if (update.openaiHost !== undefined || update.openaiPort !== undefined) {
    const host = (next.openaiHost ?? '').trim();
    if (host) {
      next.openaiBaseUrl = buildOpenAiBaseUrl({ protocol: 'http', host, port: (next.openaiPort ?? '').trim(), path: '/v1' });
    }
  }

  // Never leave host/port stored without a usable URL (e.g. an older settings row or a partial update).
  if (!next.openaiBaseUrl) {
    const host = (next.openaiHost ?? '').trim();
    if (host) next.openaiBaseUrl = buildOpenAiBaseUrl({ protocol: 'http', host, port: (next.openaiPort ?? '').trim(), path: '/v1' });
  }

  kv.set(KEY, next);
  return publicSettings();
}

/** Resolve the effective Civitai token (DB override > env fallback). */
export function resolveCivitaiToken(): string | undefined {
  return getStoredSettings().civitaiToken || CIVITAI_TOKEN;
}

/** Resolve the effective Hugging Face token (DB override > env fallback). */
export function resolveHfToken(): string | undefined {
  return getStoredSettings().hfToken || HF_TOKEN;
}
