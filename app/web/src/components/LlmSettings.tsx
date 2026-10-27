import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Bot, Check, CheckCircle2, ExternalLink, LogIn, LogOut, RefreshCw, Send, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Button } from './ui';
import { buildOpenAiBaseUrl, parseOpenAiBaseUrl } from '@shared/llm';
import type { LlmProvider, Settings, SettingsUpdate } from '@shared/types';

function inputClass() {
  return 'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-amber-400)]/50 disabled:opacity-60';
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-3)]">{hint}</div>}
    </div>
  );
}

function LoopbackRelayHelp({ forceOpen }: { forceOpen: boolean }) {
  return (
    <details
      open={forceOpen}
      className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]"
    >
      <summary className="cursor-pointer select-none font-medium text-[var(--color-ink-1)]">
        Model not discovered? Forward loopback on port 8889
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          <strong>Find models</strong> can fail even while Unsloth is running in the background. On Windows + WSL2 (or Docker
          Desktop), Unsloth may listen only on the Windows loopback, and the studio container cannot reach it. Forward it on a
          second port from the host machine — the same WSL shell where you run <code className="text-[var(--color-ink-0)]">make</code>,
          not inside the container:
        </p>
        <pre className="overflow-x-auto rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-2 py-1.5 font-mono text-[11px] text-[var(--color-ink-0)]">
          make llm-relay
        </pre>
        <p>
          Then set <strong>Host</strong> to <code className="text-[var(--color-ink-0)]">127.0.0.1</code> and <strong>Port</strong> to{' '}
          <code className="text-[var(--color-ink-0)]">8889</code> above (keep API path <code className="text-[var(--color-ink-0)]">/v1</code>),
          and press <strong>Find models</strong> again. The relay listens on <code className="text-[var(--color-ink-0)]">0.0.0.0:8889</code>,
          forwards to Unsloth on <code className="text-[var(--color-ink-0)]">127.0.0.1:8888</code>, and rewrites the{' '}
          <code className="text-[var(--color-ink-0)]">Host</code> header Unsloth checks. Keep it running in its own terminal.
        </p>
        <p>
          Different ports? <code className="text-[var(--color-ink-0)]">LLM_RELAY_PORT=8889 LLM_TARGET_PORT=8888 make llm-relay</code>.
          Without make, run <code className="text-[var(--color-ink-0)]">node scripts/llm-relay.mjs</code> from the app folder.
        </p>
      </div>
    </details>
  );
}

function KeyField({
  label,
  isSet,
  value,
  onChange,
  onClear,
  placeholder,
}: {
  label: string;
  isSet: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet ? '••••• set — enter a new value to replace' : placeholder}
          className={inputClass()}
        />
        {isSet && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}

/** AI provider settings: Anthropic, or any OpenAI-compatible server (Unsloth/llama.cpp, LM Studio, OpenRouter…). */
export function LlmSettings({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const initial = parseOpenAiBaseUrl(settings.openaiBaseUrl);
  const [provider, setProvider] = useState<LlmProvider>(settings.llmProvider);
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropicModel);
  const [protocol, setProtocol] = useState<'http' | 'https'>(initial.protocol);
  const [host, setHost] = useState(settings.openaiHost || initial.host);
  const [port, setPort] = useState(settings.openaiPort || initial.port);
  const [basePath, setBasePath] = useState(initial.path);
  const [model, setModel] = useState(settings.openaiModel);
  const [opencodeModel, setOpencodeModel] = useState(settings.opencodeModel);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [signIn, setSignIn] = useState<{ attemptID: string; url: string; instructions: string } | null>(null);

  // After a save, adopt the server's canonical host/port (e.g. a pasted full URL is split up).
  useEffect(() => {
    const parsed = parseOpenAiBaseUrl(settings.openaiBaseUrl);
    setProtocol(parsed.protocol);
    setHost(settings.openaiHost || parsed.host);
    setPort(settings.openaiPort || parsed.port);
    setBasePath(parsed.path);
    setModel(settings.openaiModel);
    setOpencodeModel(settings.opencodeModel);
    setAnthropicModel(settings.anthropicModel);
  }, [settings.openaiHost, settings.openaiPort, settings.openaiBaseUrl, settings.openaiModel, settings.opencodeModel, settings.anthropicModel]);

  const baseUrl = buildOpenAiBaseUrl({ protocol, host, port, path: basePath });

  const save = useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: (updated) => {
      qc.setQueryData(['settings'], updated);
      qc.invalidateQueries({ queryKey: ['system'] });
      setOpenaiKey('');
      setAnthropicKey('');
      setShowSaved(true);
      toast({ title: 'AI settings saved', variant: 'success' });
    },
    onError: (err) => toast({ title: 'Could not save AI settings', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  const models = useQuery({
    queryKey: ['llm-models', baseUrl],
    queryFn: () => api.llmModels({ baseUrl, host, port, apiKey: openaiKey.trim() || undefined }),
    enabled: false,
    retry: false,
  });

  const test = useMutation({
    mutationFn: () =>
      api.llmTest({
        baseUrl,
        host,
        port,
        apiKey: openaiKey.trim() || undefined,
        model: model.trim(),
      }),
    onSuccess: (result) => {
      toast({ title: 'LLM connected', description: `${result.model} replied in ${result.latencyMs} ms.`, variant: 'success' });
    },
    onError: (err) => toast({ title: 'Could not reach the LLM', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  const openCode = useQuery({
    queryKey: ['opencode-status'],
    queryFn: api.openCodeStatus,
    enabled: provider === 'opencode',
    retry: false,
    staleTime: 15_000,
  });

  const signInPoll = useQuery({
    queryKey: ['opencode-signin', signIn?.attemptID],
    queryFn: () => api.openCodeConnectStatus(signIn!.attemptID),
    enabled: Boolean(signIn),
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2_000 : false),
  });

  useEffect(() => {
    if (!signIn || !signInPoll.data) return;
    if (signInPoll.data.status === 'complete') {
      setSignIn(null);
      qc.invalidateQueries({ queryKey: ['opencode-status'] });
      toast({ title: 'Signed in to OpenCode', description: 'Your account is saved for future sessions.', variant: 'success' });
    } else if (signInPoll.data.status === 'failed' || signInPoll.data.status === 'expired') {
      setSignIn(null);
      toast({
        title: signInPoll.data.status === 'expired' ? 'Sign-in expired' : 'OpenCode sign-in failed',
        description: signInPoll.data.message,
        variant: 'error',
      });
    }
  }, [signIn, signInPoll.data, qc]);

  const startSignIn = useMutation({
    mutationFn: api.openCodeConnect,
    onSuccess: (attempt) => {
      setSignIn(attempt);
      // The device page is a normal web page; opening it here is the browser sign-in.
      window.open(attempt.url, '_blank', 'noopener,noreferrer');
    },
    onError: (err) =>
      toast({ title: 'Could not start OpenCode sign-in', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  const disconnect = useMutation({
    mutationFn: api.openCodeDisconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opencode-status'] });
      toast({ title: 'Signed out of OpenCode', variant: 'success' });
    },
    onError: (err) => toast({ title: 'Could not sign out', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  const testOpenCode = useMutation({
    mutationFn: () => api.openCodeTest(opencodeModel.trim()),
    onSuccess: (result) => {
      toast({ title: 'OpenCode connected', description: `${result.model} replied in ${result.latencyMs} ms.`, variant: 'success' });
    },
    onError: (err) => toast({ title: 'Could not reach OpenCode', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  async function discoverModels() {
    const result = await models.refetch();
    if (!result.data) return;
    // Prefer the model the server already has loaded: servers like Unsloth also advertise
    // models from other backends (e.g. `ollama/...`), and those sort first alphabetically.
    const suggested = result.data.loadedModels?.[0] ?? result.data.models[0];
    if (!model.trim() && suggested) setModel(suggested);
    toast({
      title: `Found ${result.data.models.length} model${result.data.models.length === 1 ? '' : 's'}`,
      description: 'Choose one from the model field.',
      variant: 'success',
    });
  }

  function saveAll() {
    const body: SettingsUpdate = {
      llmProvider: provider,
      anthropicModel: anthropicModel.trim(),
      openaiHost: host.trim(),
      openaiPort: port.trim(),
      openaiBaseUrl: baseUrl,
      openaiModel: model.trim(),
      opencodeModel: opencodeModel.trim(),
    };
    if (openaiKey.trim()) body.openaiApiKey = openaiKey.trim();
    if (anthropicKey.trim()) body.anthropicApiKey = anthropicKey.trim();
    save.mutate(body);
  }

  function chooseProvider(next: LlmProvider) {
    setProvider(next);
    setShowSaved(false);
    if (next === 'openai_compatible' && !host.trim()) {
      setProtocol('http');
      setHost('127.0.0.1');
      setPort(port.trim() || '8888');
      setBasePath('/v1');
    }
  }

  const loadedModels = new Set(models.data?.loadedModels ?? []);
  const discovered = [...(models.data?.models ?? [])].sort(
    (a, b) => Number(loadedModels.has(b)) - Number(loadedModels.has(a)) || a.localeCompare(b),
  );
  const openAiReady = Boolean(baseUrl && model.trim());
  const savedConnected =
    settings.llmProvider === 'anthropic'
      ? settings.anthropicApiKeySet
      : settings.llmProvider === 'openai_compatible'
        ? Boolean(settings.openaiBaseUrl && settings.openaiModel)
        : settings.llmProvider === 'opencode'
          ? Boolean(settings.opencodeModel) && Boolean(openCode.data?.connected)
          : false;

  return (
    <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">
          <Bot className="size-4 text-[var(--color-ink-2)]" />
          AI provider
        </h2>
        <span
          className={
            !savedConnected
              ? 'rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[11px] text-[var(--color-ink-3)]'
              : 'rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[11px] text-[var(--color-success)]'
          }
        >
          {savedConnected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
        Script writing, scene breakdown and prompt enhancement use this. Use Anthropic, or any OpenAI-compatible server: Unsloth (llama.cpp),
        LM Studio, Ollama, OpenRouter and others all work.
      </p>

      <Field label="Provider">
        <select value={provider} onChange={(e) => chooseProvider(e.target.value as LlmProvider)} className={inputClass()}>
          <option value="none">None</option>
          <option value="openai_compatible">OpenAI-compatible (Unsloth, llama.cpp, LM Studio…)</option>
          <option value="opencode">OpenCode (sign in with your account)</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </Field>

      {provider === 'anthropic' && (
        <div className="space-y-3">
          <Field label="Anthropic model">
            <input value={anthropicModel} onChange={(e) => setAnthropicModel(e.target.value)} placeholder="claude-sonnet-5" className={inputClass()} />
          </Field>
          <KeyField
            label="Anthropic API key"
            isSet={settings.anthropicApiKeySet}
            value={anthropicKey}
            onChange={setAnthropicKey}
            onClear={() => save.mutate({ anthropicApiKey: '' })}
            placeholder="sk-ant-…"
          />
        </div>
      )}

      {provider === 'opencode' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2.5">
            {openCode.isFetching && !openCode.data ? (
              <div className="text-[11px] text-[var(--color-ink-3)]">Starting the OpenCode runtime…</div>
            ) : openCode.error ? (
              <div className="text-[11px] leading-relaxed text-[var(--color-danger)]">
                {(openCode.error as Error).message}
              </div>
            ) : openCode.data?.connected ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--color-ink-2)]">
                  <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-success)]" />
                  <span className="truncate">
                    Signed in{openCode.data.account ? ` as ${openCode.data.account}` : ''}. The token stays on the server.
                  </span>
                </div>
                <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                  Sign in with your OpenCode Console account to use its models. The browser handles the login; the
                  studio never sees or stores the token, and the model never receives it.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<LogIn className="size-3.5" />}
                    loading={startSignIn.isPending}
                    onClick={() => startSignIn.mutate()}
                  >
                    Sign in with OpenCode
                  </Button>
                  {signIn && (
                    <a
                      href={signIn.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-[var(--color-amber-300)] hover:underline"
                    >
                      Open the sign-in page <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                {signIn && (
                  <div className="rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                    <div className="font-mono text-[var(--color-ink-0)]">{signIn.instructions}</div>
                    <div className="mt-1 text-[var(--color-ink-3)]">
                      {signInPoll.data?.status === 'pending' ? 'Waiting for you to approve the code…' : 'Finish the sign-in in the browser tab.'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Field
            label="OpenCode model"
            hint="Models available to your OpenCode account. Pick one here; a free model works before signing in."
          >
            <div className="flex items-center gap-2">
              <input
                value={opencodeModel}
                onChange={(e) => setOpencodeModel(e.target.value)}
                placeholder="big-pickle"
                className={clsx(inputClass(), 'min-w-0 flex-1')}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                loading={openCode.isFetching}
                onClick={() => openCode.refetch()}
                className="shrink-0 whitespace-nowrap"
              >
                Refresh
              </Button>
            </div>
          </Field>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--color-ink-3)]">
              {openCode.data ? `${openCode.data.models.length} model${openCode.data.models.length === 1 ? '' : 's'} available` : 'Model list unavailable'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Send className="size-3.5" />}
              loading={testOpenCode.isPending}
              disabled={!opencodeModel.trim()}
              onClick={() => testOpenCode.mutate()}
            >
              Test
            </Button>
          </div>

          {(openCode.data?.models.length ?? 0) > 0 && (
            <div role="listbox" aria-label="OpenCode models" className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-1">
              {openCode.data!.models.map((entry) => {
                const selected = opencodeModel.trim() === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    title={entry.id}
                    onClick={() => setOpencodeModel(entry.id)}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      selected
                        ? 'bg-[var(--color-amber-400)]/12 text-[var(--color-ink-0)]'
                        : 'text-[var(--color-ink-2)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px]">{entry.name}</span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-[var(--color-ink-3)]">{entry.id}</span>
                    {selected && <Check className="size-3.5 shrink-0 text-[var(--color-amber-400)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {provider === 'openai_compatible' && (
        <div className="space-y-3">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-2">
            <Field label="Scheme">
              <select value={protocol} onChange={(e) => setProtocol(e.target.value as 'http' | 'https')} className={inputClass()}>
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </Field>
            <Field
              label="Host"
              hint={
                <>
                  In Docker, <code className="text-[var(--color-ink-2)]">127.0.0.1</code> and{' '}
                  <code className="text-[var(--color-ink-2)]">localhost</code> are translated to{' '}
                  <code className="text-[var(--color-ink-2)]">host.docker.internal</code> automatically. On Linux the host server must
                  listen on <code className="text-[var(--color-ink-2)]">0.0.0.0</code>, not only 127.0.0.1.
                </>
              }
            >
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" className={inputClass()} />
            </Field>
            <Field label="Port">
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="8888" inputMode="numeric" className={inputClass()} />
            </Field>
          </div>

          <Field label="API path" hint="Most servers use /v1. OpenRouter uses /api/v1.">
            <input value={basePath} onChange={(e) => setBasePath(e.target.value)} placeholder="/v1" className={inputClass()} />
          </Field>

          <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 font-mono text-[11px] text-[var(--color-ink-2)]">
            {baseUrl || 'Add a host to see the base URL'}
          </div>

          <Field
            label="Model"
            hint={
              <>
                Pick a discovered model below or type an id. Local Unsloth ids can contain colons, e.g.{' '}
                <code className="text-[var(--color-ink-2)]">unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL</code>.
              </>
            }
          >
            <div className="flex items-center gap-2">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL"
                className={clsx(inputClass(), 'min-w-0 flex-1')}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                loading={models.isFetching}
                disabled={!baseUrl}
                onClick={discoverModels}
                className="shrink-0 whitespace-nowrap"
              >
                Find models
              </Button>
            </div>
          </Field>

          {(models.isFetching || models.data || models.error) && (
            <div className="text-[11px] leading-relaxed text-[var(--color-ink-3)]">
              {models.isFetching && 'Asking the server which models it can run…'}
              {!models.isFetching && models.data && (
                <>
                  Found {models.data.models.length} model{models.data.models.length === 1 ? '' : 's'}. Pick one below, or type an id.
                </>
              )}
              {!models.isFetching && models.error && (
                <span className="text-[var(--color-danger)]">{(models.error as Error).message}</span>
              )}
            </div>
          )}

          {discovered.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)]">
              <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-3 py-1.5 text-[11px] text-[var(--color-ink-3)]">
                <span>{discovered.length} available</span>
                <span>Click a model to use it</span>
              </div>
              <div role="listbox" aria-label="Discovered models" className="max-h-48 overflow-y-auto p-1">
                {discovered.map((id) => {
                  const selected = model.trim() === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={id}
                      onClick={() => setModel(id)}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        selected
                          ? 'bg-[var(--color-amber-400)]/12 text-[var(--color-ink-0)]'
                          : 'text-[var(--color-ink-2)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{id}</span>
                      {loadedModels.has(id) && (
                        <span className="shrink-0 rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-success)]">
                          loaded
                        </span>
                      )}
                      {selected && <Check className="size-3.5 shrink-0 text-[var(--color-amber-400)]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <LoopbackRelayHelp forceOpen={Boolean(models.error)} />

          <KeyField
            label="API key"
            isSet={settings.openaiApiKeySet}
            value={openaiKey}
            onChange={setOpenaiKey}
            onClear={() => save.mutate({ openaiApiKey: '' })}
            placeholder="not-needed (leave blank for local servers)"
          />
          <p className="-mt-1 text-[11px] text-[var(--color-ink-3)]">
            Most local Unsloth/llama.cpp servers accept any token or none. Hosted providers need their real key.
          </p>

          {test.data && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-xs text-[var(--color-success)]">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {test.data.model} replied “{test.data.reply}” in {test.data.latencyMs} ms.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-hairline)] pt-3">
        <Button
          variant="primary"
          icon={<Sparkles className="size-4" />}
          loading={save.isPending}
          onClick={saveAll}
        >
          Save AI settings
        </Button>
        {provider === 'openai_compatible' && (
          <Button
            variant="secondary"
            icon={<Send className="size-3.5" />}
            loading={test.isPending}
            disabled={!openAiReady || test.isPending}
            onClick={() => test.mutate()}
          >
            Test connection
          </Button>
        )}
        {showSaved && !save.isPending && <span className="text-xs text-[var(--color-success)]">Saved</span>}
        {provider === 'none' && <span className="text-xs text-[var(--color-ink-3)]">AI features stay off until you pick a provider.</span>}
      </div>
    </section>
  );
}
