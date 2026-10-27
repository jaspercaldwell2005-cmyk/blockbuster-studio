import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { api, mediaUrl } from '../../lib/api';
import { toast } from '../../lib/store';
import { aspectParts } from '@shared/presets';
import type { AspectRatio, Scene } from '@shared/types';

/** The one still every scene starts with: its cover on the storyboard, and the plate its shot keyframes
 *  compose from. Click the empty tile to make (or remake) it. */
export function SceneConceptCard({
  scene,
  projectId,
  aspect,
}: {
  scene: Scene;
  projectId: string;
  aspect: AspectRatio;
}) {
  const qc = useQueryClient();
  const { data: asset } = useQuery({
    queryKey: ['asset', scene.conceptAssetId],
    queryFn: () => api.asset(scene.conceptAssetId!),
    enabled: !!scene.conceptAssetId,
  });
  const generate = useMutation({
    mutationFn: () => api.sceneConcept(scene.id),
    onSuccess: () => {
      toast({ title: 'Scene still queued', description: 'Shots in this scene will keep its look.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast({ title: 'Could not queue the scene still', description: (err as Error).message, variant: 'error' }),
  });

  const [aw, ah] = aspectParts(aspect);
  const portrait = ah > aw;

  return (
    <div
      className={clsx(
        'group relative shrink-0 overflow-hidden rounded-xl border bg-[var(--color-bg-2)]',
        portrait ? 'w-40' : 'w-56',
        asset ? 'border-[var(--color-hairline)]' : 'border-dashed border-[var(--color-hairline-strong)]',
      )}
    >
      <div className="relative w-full bg-black" style={{ aspectRatio: `${aw} / ${ah}` }}>
        {asset ? (
          <img src={mediaUrl(asset.thumb ?? asset.file)} alt={`${scene.title} concept still`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-2)]">
            <ImageIcon className="size-6" />
            <span className="text-[11px] font-medium">Scene still</span>
          </div>
        )}
        {asset && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
            <p className="chip-mono text-[10px] text-white/90">Scene still</p>
          </div>
        )}
        {!asset && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="absolute inset-0 flex items-center justify-center bg-transparent text-[var(--color-amber-300)] opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 disabled:opacity-100"
            aria-label="Generate scene still"
          >
            <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium">
              <Sparkles className="size-3" /> {generate.isPending ? 'Queueing…' : 'Generate'}
            </span>
          </button>
        )}
      </div>
      <div className="flex h-[3.75rem] flex-col gap-0.5 px-2.5 py-2">
        <p className="line-clamp-2 text-xs leading-snug text-[var(--color-ink-2)]">{scene.description || 'The scene’s establishing still'}</p>
        {asset && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="mt-auto self-start text-[11px] font-medium text-[var(--color-amber-300)] hover:text-[var(--color-amber-200)] disabled:opacity-60"
          >
            {generate.isPending ? 'Queueing…' : 'Remake still'}
          </button>
        )}
        {!asset && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="mt-auto self-start text-[11px] font-medium text-[var(--color-amber-300)] hover:text-[var(--color-amber-200)] disabled:opacity-60"
          >
            {generate.isPending ? 'Queueing…' : 'Generate still'}
          </button>
        )}
      </div>
    </div>
  );
}
