// Disk-usage bookkeeping and cleanup for the studio's generated files and service logs.
// Kept separate from the Hono routes so the deletion rules (and what counts as "unused") are testable.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config';
import { assets as assetsRepo, characters, jobs, locations, loras, projects, scenes, shots } from './db';
import { emit } from './events';
import type { Asset, ID, StorageUsage } from '../shared/types';

const MEDIA_ROOT = path.join(DATA_DIR, 'media');

/** Asset ids still referenced by a project, storyboard, cast, location or LoRA. */
export function referencedAssetIds(): Set<ID> {
  const ids = new Set<ID>();
  const add = (id?: ID | null) => {
    if (id) ids.add(id);
  };

  const projectList = projects.list();
  for (const project of projectList) {
    add(project.coverAssetId);
    add(project.exportAssetId);
    for (const scene of scenes.listByProject(project.id)) {
      add(scene.conceptAssetId);
      add(scene.referenceSheetAssetId);
      add(scene.previsAssetId);
      add(scene.previsDepthAssetId);
    }
    for (const shot of shots.listByProject(project.id)) {
      add(shot.keyframeAssetId);
      add(shot.endKeyframeAssetId);
      add(shot.videoAssetId);
      add(shot.controlVideoAssetId);
      add(shot.referenceVideoAssetId);
      add(shot.dialogueAudioAssetId);
      shot.keyframeCandidates.forEach(add);
      shot.videoCandidates.forEach(add);
      shot.referenceAssetIds?.forEach(add);
    }
  }
  for (const character of characters.list()) {
    character.referenceAssetIds.forEach(add);
    add(character.sheetAssets?.face);
    add(character.sheetAssets?.turnaround);
    add(character.voice?.refAssetId);
  }
  for (const location of locations.list()) {
    add(location.establishingAssetId);
    add(location.map?.backgroundAssetId);
    location.angleViews.forEach((view) => add(view.assetId));
  }
  for (const lora of loras.list()) add(lora.previewAssetId);

  // Queued/running jobs can name an asset as an input before any project row points at it (for example an
  // edit queued from the Create page). Keep those alive until the job has run.
  const addFromJobParams = (value: unknown) => {
    if (typeof value === 'string') ids.add(value);
    else if (Array.isArray(value)) value.forEach(addFromJobParams);
    else if (value && typeof value === 'object') Object.values(value).forEach(addFromJobParams);
  };
  for (const job of jobs.list({ active: true })) addFromJobParams(job.params);

  return ids;
}

/** A generated file no project or library record points at. Uploads and exports (the finished film) are
 *  never bulk-deleted, and favorites are always kept. */
export function isUnusedGenerated(asset: Asset, referenced: ReadonlySet<ID>): boolean {
  return (
    asset.origin === 'generated' &&
    !asset.favorite &&
    !asset.projectId &&
    !asset.shotId &&
    !referenced.has(asset.id)
  );
}

function mediaPath(rel?: string): string | undefined {
  if (!rel) return undefined;
  const full = path.join(MEDIA_ROOT, rel);
  return full.startsWith(MEDIA_ROOT + path.sep) ? full : undefined;
}

function fileBytes(full?: string): number {
  if (!full) return 0;
  try {
    return fs.statSync(full).size;
  } catch {
    return 0;
  }
}

/** Bytes the asset occupies on disk: its file plus its thumbnail. */
export function assetBytes(asset: Asset): number {
  return fileBytes(mediaPath(asset.file)) + fileBytes(mediaPath(asset.thumb));
}

function logFiles(dataDir: string): string[] {
  try {
    return fs
      .readdirSync(path.join(dataDir, 'logs'))
      .filter((name) => name.endsWith('.log'))
      .map((name) => path.join(dataDir, 'logs', name))
      .filter((file) => {
        try {
          return fs.statSync(file).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function logUsage(dataDir = DATA_DIR): StorageUsage['logs'] {
  const files = logFiles(dataDir);
  return { files: files.length, bytes: files.reduce((sum, file) => sum + fileBytes(file), 0) };
}

/** Truncate every service log in place. Truncating (rather than unlinking) is deliberate: the running
 *  processes hold these files open with O_APPEND, so new lines still land in the same file afterwards. */
export function clearLogs(dataDir = DATA_DIR): { files: number; bytes: number } {
  const files = logFiles(dataDir);
  let bytes = 0;
  let cleared = 0;
  for (const file of files) {
    try {
      bytes += fileBytes(file);
      fs.truncateSync(file, 0);
      cleared++;
    } catch {
      // A log that vanished or is read-only shouldn't stop the others.
    }
  }
  return { files: cleared, bytes };
}

export function storageUsage(): StorageUsage {
  const all = assetsRepo.listAll();
  const referenced = referencedAssetIds();
  const output = all.filter((asset) => asset.origin !== 'upload');
  const unused = output.filter((asset) => isUnusedGenerated(asset, referenced));

  return {
    output: { assets: output.length, bytes: output.reduce((sum, asset) => sum + assetBytes(asset), 0) },
    unused: { assets: unused.length, bytes: unused.reduce((sum, asset) => sum + assetBytes(asset), 0) },
    logs: logUsage(),
  };
}

/** Remove unused generated assets (files, thumbnails and database rows) and return how much was freed. */
export async function deleteUnusedGeneratedAssets(): Promise<{ deleted: number; bytes: number }> {
  const referenced = referencedAssetIds();
  const doomed = assetsRepo.listAll().filter((asset) => isUnusedGenerated(asset, referenced));

  let bytes = 0;
  let deleted = 0;
  for (const asset of doomed) {
    bytes += assetBytes(asset);
    const file = mediaPath(asset.file);
    const thumb = mediaPath(asset.thumb);
    if (file) await fsp.rm(file, { force: true }).catch(() => undefined);
    if (thumb) await fsp.rm(thumb, { force: true }).catch(() => undefined);
    assetsRepo.delete(asset.id);
    emit({ type: 'asset_deleted', id: asset.id });
    deleted++;
  }
  return { deleted, bytes };
}
