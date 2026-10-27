// Shared reference-image planning: before keyframes (and a scene's concept still) can compose consistent
// faces and places, each cast member needs a reference image and each location an establishing image.
import { characters as charactersRepo, jobs as jobsRepo, locations as locationsRepo, scenes as scenesRepo } from '../db';
import { enqueue } from './queue';
import type { ID, Job, Project, Shot } from '../../shared/types';

/** Queue missing character references and location establishing images for these shots. Jobs are enqueued in
 *  order, so they finish before the keyframes/concepts that use them. `chainId` keeps a one-prompt run in strict
 *  order (see pickNext in queue.ts). */
export function enqueueMissingReferences(project: Project, shots: Shot[], chainId?: string): Job[] {
  const active = jobsRepo.list({ active: true });
  const queued = (type: Job['type'], key: string, id: ID) => active.some((j) => j.type === type && j.params[key] === id);
  const chain = chainId ? { chainId } : {};
  const jobs: Job[] = [];
  for (const id of new Set(shots.flatMap((s) => s.characterIds))) {
    const c = charactersRepo.get(id);
    if (!c || c.referenceAssetIds.length > 0 || queued('character_refs', 'characterId', id)) continue;
    jobs.push(enqueue({ type: 'character_refs', title: `Reference sheet: ${c.name}`, params: { characterId: id, count: 2, aspect: '1:1', ...chain }, projectId: project.id }));
  }
  const sceneIds = new Set(shots.map((s) => s.sceneId));
  const locationIds = new Set(scenesRepo.listByProject(project.id).filter((s) => sceneIds.has(s.id) && s.locationId).map((s) => s.locationId!));
  for (const id of locationIds) {
    const l = locationsRepo.get(id);
    if (!l || l.establishingAssetId || queued('location_establishing', 'locationId', id)) continue;
    jobs.push(enqueue({ type: 'location_establishing', title: `Establishing shot: ${l.name}`, params: { locationId: id, aspect: project.aspect, ...chain }, projectId: project.id }));
  }
  return jobs;
}
