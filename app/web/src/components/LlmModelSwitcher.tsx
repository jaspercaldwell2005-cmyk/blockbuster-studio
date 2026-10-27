import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clsx } from 'clsx';
import { Bot, Check, ChevronDown, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Popover } from './ui';

/** Header shortcut for swapping the active LLM model (OpenAI-compatible or OpenCode). */
export function LlmModelSwitcher() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const data = settings.data;
  const openAi = data?.llmProvider === 'openai_compatible';
  const openCode = data?.llmProvider === 'opencode';
  const configured = (openAi && Boolean(data?.openaiModel)) || (openCode && Boolean(data?.opencodeModel));

  const openAiModels = useQuery({
    queryKey: ['llm-models', 'header', data?.openaiBaseUrl, data?.openaiHost, data?.openaiPort],
    queryFn: () =>
      api.llmModels({
        baseUrl: data?.openaiBaseUrl,
        host: data?.openaiHost,
        port: data?.openaiPort,
      }),
    enabled: open && openAi,
    retry: false,
    staleTime: 30_000,
  });

  const openCodeStatus = useQuery({
    queryKey: ['opencode-status'],
    queryFn: api.openCodeStatus,
    enabled: open && openCode,
    retry: false,
    staleTime: 30_000,
  });

  const choose = useMutation({
    mutationFn: (modelID: string) => api.updateSettings(openCode ? { opencodeModel: modelID } : { openaiModel: modelID }),
    onSuccess: (updated) => {
      qc.setQueryData(['settings'], updated);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['system'] });
      setOpen(false);
      toast({
        title: 'LLM model changed',
        description: openCode ? updated.opencodeModel : updated.openaiModel,
        variant: 'success',
      });
    },
    onError: (err) =>
      toast({
        title: 'Could not change the LLM model',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      }),
  });

  if (!configured || !data) return null;

  const current = (openCode ? data.opencodeModel : data.openaiModel).trim();
  const loadedModels = new Set(openAiModels.data?.loadedModels ?? []);
  const available = openCode
    ? (openCodeStatus.data?.models ?? []).map((entry) => ({ id: entry.id, name: entry.name }))
    : [...(openAiModels.data?.models ?? [])]
        .sort((a, b) => Number(loadedModels.has(b)) - Number(loadedModels.has(a)) || a.localeCompare(b))
        .map((id) => ({ id, name: id }));

  const query = openCode ? openCodeStatus : openAiModels;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          onClick={onClick}
          aria-label={`LLM model: ${current}`}
          title={`LLM model: ${current}`}
          className="flex h-9 max-w-[18rem] items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-2.5 text-xs text-[var(--color-ink-1)] transition-colors hover:bg-[var(--color-bg-2)]"
        >
          <Bot className="size-4 shrink-0 text-[var(--color-ink-2)]" />
          <span className="chip-mono hidden min-w-0 truncate sm:inline">{current}</span>
          <ChevronDown className="size-3.5 shrink-0 text-[var(--color-ink-3)]" />
        </button>
      )}
    >
      <div className="w-[min(26rem,calc(100vw-2rem))] p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-[var(--color-ink-0)]">LLM model</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
              Used for script writing, scene breakdown and prompt enhancement.
            </div>
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh model list"
            title="Refresh model list"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-2)] transition-colors hover:bg-white/6 hover:text-[var(--color-ink-0)] disabled:opacity-40"
          >
            <RefreshCw className={clsx('size-3.5', query.isFetching && 'animate-spin')} />
          </button>
        </div>

        {query.isFetching && <div className="px-1 py-2 text-[11px] text-[var(--color-ink-3)]">Asking the server which models it can run…</div>}

        {!query.isFetching && query.error && (
          <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-danger)]">
            {(query.error as Error).message}
          </div>
        )}

        {!query.isFetching && !query.error && available.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-[var(--color-ink-3)]">
            No models found. {openCode ? 'Sign in or refresh in Settings.' : 'Check the endpoint in Settings.'}
          </div>
        )}

        {available.length > 0 && (
          <div role="listbox" aria-label="LLM models" className="max-h-72 overflow-y-auto">
            {available.map((entry) => {
              const selected = entry.id === current;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={entry.id}
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(entry.id)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50',
                    selected
                      ? 'bg-[var(--color-amber-400)]/12 text-[var(--color-ink-0)]'
                      : 'text-[var(--color-ink-2)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{entry.id}</span>
                  {openCode && entry.name !== entry.id && (
                    <span className="min-w-0 truncate text-[10px] text-[var(--color-ink-3)]">{entry.name}</span>
                  )}
                  {!openCode && loadedModels.has(entry.id) && (
                    <span className="shrink-0 rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-success)]">
                      loaded
                    </span>
                  )}
                  {selected && <Check className="size-3.5 shrink-0 text-[var(--color-amber-400)]" />}
                </button>
              );
            })}
          </div>
        )}

        <Link
          to="/settings"
          onClick={() => setOpen(false)}
          className="mt-2 flex items-center justify-center rounded-md border border-[var(--color-hairline)] px-2 py-1.5 text-[11px] text-[var(--color-ink-2)] hover:bg-white/6 hover:text-[var(--color-ink-0)]"
        >
          AI provider settings
        </Link>
      </div>
    </Popover>
  );
}
