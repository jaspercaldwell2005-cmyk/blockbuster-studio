import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../../lib/store';
import type { BreakdownDraft, Project } from '@shared/types';
import { Button } from '../ui';
import { useDebouncedCallback } from './hooks';
import { BreakdownReview } from './BreakdownReview';

export function ScriptTab({
  project,
  autoBreakdown,
  hasStoryboard,
  onApplied,
}: {
  project: Project;
  autoBreakdown?: boolean;
  /** True when the film already has scenes: the quick prompt should only add to them deliberately. */
  hasStoryboard?: boolean;
  onApplied: () => void;
}) {
  const [script, setScript] = useState(project.script);
  const [draft, setDraft] = useState<BreakdownDraft | null>(null);
  const [quickPrompt, setQuickPrompt] = useState('');
  // The first prompt on an empty film also plans the storyboard; on an existing film, opt in.
  const [planScenes, setPlanScenes] = useState(!hasStoryboard);
  const qc = useQueryClient();

  useEffect(() => setScript(project.script), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once a storyboard exists, don't add to it unless the user asks.
  useEffect(() => setPlanScenes(!hasStoryboard), [hasStoryboard]);

  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });

  const saveScript = useMutation({ mutationFn: (s: string) => api.updateProject(project.id, { script: s }) });
  const debouncedSave = useDebouncedCallback((s: string) => saveScript.mutate(s), 800);

  const breakdown = useMutation({
    mutationFn: (text: string) => api.breakdown(project.id, text),
    onSuccess: (d) => setDraft(d),
    onError: (err) => toast({ title: 'Breakdown failed', description: (err as Error).message, variant: 'error' }),
  });

  const writeScript = useMutation({
    mutationFn: () => api.writeScript(project.id, quickPrompt.trim()),
    onSuccess: (updated) => {
      setScript(updated.script);
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      if (planScenes) {
        toast({ title: 'Script written', description: 'Planning the scenes and shots now.', variant: 'success' });
        breakdown.mutate(updated.script);
      } else {
        toast({ title: 'Script written', description: 'Edit it below, then break it down.', variant: 'success' });
      }
    },
    onError: (err) => toast({ title: 'Could not write the script', description: (err as Error).message, variant: 'error' }),
  });

  function writeWithQuickPrompt() {
    if (!quickPrompt.trim()) return;
    if (script.trim() && !window.confirm('Replace the current script with one written from this quick prompt?')) return;
    writeScript.mutate();
  }

  // New films created from an idea break down straight away (once).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoBreakdown || autoStarted.current || !system?.llmConfigured || !script.trim()) return;
    autoStarted.current = true;
    breakdown.mutate(script);
  }, [autoBreakdown, system?.llmConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  const writing = writeScript.isPending;
  const planning = breakdown.isPending;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      {system && (
        <div className="rounded-xl border border-[var(--color-amber-400)]/30 bg-[var(--color-amber-400)]/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-[var(--color-amber-300)]" />
            <span className="text-sm font-medium text-[var(--color-ink-0)]">Quick prompt</span>
            <span className="text-[11px] text-[var(--color-ink-3)]">AI writes the script, then plans the scenes</span>
          </div>
          <textarea
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            rows={2}
            placeholder={system.llmConfigured ? 'A courier finds her last delivery is a bomb…' : 'Connect an AI provider in Settings to write a script from a prompt.'}
            disabled={!system.llmConfigured}
            className="mt-2 w-full resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-amber-400)]/50 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="mr-auto flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
              <input
                type="checkbox"
                checked={planScenes}
                onChange={(e) => setPlanScenes(e.target.checked)}
                disabled={!system.llmConfigured}
                className="accent-[var(--color-amber-400)]"
              />
              Plan the scenes and shots
              {planScenes && hasStoryboard && <span className="text-[var(--color-ink-3)]">(adds new scenes to the storyboard)</span>}
            </label>
            <Button
              variant="primary"
              icon={<Wand2 className="size-4" />}
              loading={writing || (planScenes && planning)}
              disabled={!system.llmConfigured || !quickPrompt.trim() || writing || (planScenes && planning)}
              onClick={writeWithQuickPrompt}
            >
              {planScenes ? (hasStoryboard ? 'Write script and add scenes' : 'Write script and storyboard') : 'Write script'}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            {system.llmConfigured ? (
              'The AI expands your prompt into a full screenplay. Both the prompt and the script stay editable.'
            ) : (
              <>
                Connect an AI provider in{' '}
                <Link to="/settings" className="text-[var(--color-amber-300)] hover:underline">
                  Settings
                </Link>{' '}
                to use the quick prompt.
              </>
            )}
          </p>
        </div>
      )}

      {system && !system.llmConfigured ? (
        <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4 text-sm text-[var(--color-ink-2)]">
          Write or paste your idea, then add the scenes and shots yourself, or have your AI agent plan them.
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3">
          {planning && <span className="text-xs text-[var(--color-ink-2)]">Reading your script and planning the shots. This takes about a minute.</span>}
          <Button variant="primary" icon={<Wand2 className="size-4" />} loading={planning} disabled={!script.trim() || writing} onClick={() => breakdown.mutate(script)}>
            Break down with AI
          </Button>
        </div>
      )}

      <textarea
        value={script}
        onChange={(e) => {
          setScript(e.target.value);
          debouncedSave(e.target.value);
        }}
        placeholder="Write your idea, treatment, or full screenplay here…"
        className="min-h-[50vh] flex-1 resize-none rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4 font-mono text-sm leading-relaxed text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
      />

      {draft && (
        <BreakdownReview
          open
          onClose={() => setDraft(null)}
          draft={draft}
          projectId={project.id}
          onApplied={onApplied}
        />
      )}
    </div>
  );
}
