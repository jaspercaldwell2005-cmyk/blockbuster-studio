// Settings section: how much disk the studio's generated files and service logs use, with safe cleanup
// actions. Deleting individual assets stays on the Create page (open an item or use the selection bar).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Button, Skeleton } from './ui';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function Storage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['storage'], queryFn: api.storage, refetchInterval: 15_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['storage'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
  };

  const deleteOutput = useMutation({
    mutationFn: api.deleteUnusedOutput,
    onSuccess: (res) => {
      invalidate();
      toast({
        title: `Deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`,
        description: `Freed ${formatBytes(res.bytes)}.`,
        variant: 'success',
      });
    },
    onError: (err) => toast({ title: 'Could not delete output', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  const deleteLogs = useMutation({
    mutationFn: api.deleteLogs,
    onSuccess: (res) => {
      invalidate();
      toast({ title: 'Logs deleted', description: `${res.files} file${res.files === 1 ? '' : 's'} cleared.`, variant: 'success' });
    },
    onError: (err) => toast({ title: 'Could not delete logs', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });

  return (
    <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
      <h2 className="flex items-center gap-2 font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">
        <HardDrive className="size-4 text-[var(--color-ink-2)]" />
        Storage
      </h2>
      {!data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--color-ink-1)]">Generated images, clips and films</span>
              <span className="chip-mono text-[var(--color-ink-2)]">{formatBytes(data.output.bytes)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-ink-3)]">
              {data.output.assets} file{data.output.assets === 1 ? '' : 's'}; {data.unused.assets} unused ({formatBytes(data.unused.bytes)}).
              Files used in a project, cast, location or LoRA and favorites are never bulk-deleted. To delete a specific item, open it on Create, or
              select several and use Delete in the selection bar.
            </p>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              loading={deleteOutput.isPending}
              disabled={data.unused.assets === 0}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${data.unused.assets} unused generated file${data.unused.assets === 1 ? '' : 's'} (${formatBytes(
                      data.unused.bytes,
                    )})? Files used in projects and favorites are kept. This cannot be undone.`,
                  )
                )
                  deleteOutput.mutate();
              }}
            >
              Delete unused output
            </Button>
          </div>

          <div className="space-y-1.5 border-t border-[var(--color-hairline)] pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--color-ink-1)]">Service logs</span>
              <span className="chip-mono text-[var(--color-ink-2)]">{formatBytes(data.logs.bytes)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-ink-3)]">
              Server, ComfyUI, voice and model-download logs ({data.logs.files} file{data.logs.files === 1 ? '' : 's'}). Download them first if
              you're reporting a problem.
            </p>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              loading={deleteLogs.isPending}
              disabled={data.logs.files === 0}
              onClick={() => {
                if (window.confirm(`Delete all service logs (${formatBytes(data.logs.bytes)})? New logs start from empty. This cannot be undone.`))
                  deleteLogs.mutate();
              }}
            >
              Delete logs
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
