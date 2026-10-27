// 'autopilot' job: one idea/prompt → characters, locations, scenes, shots, one concept still per scene, and
// every shot's keyframe. It stops there: animating and exporting stay the user's call (see the New film dialog).
import { enqueue, registerRunner } from './queue';
import { characters as charactersRepo, locations as locationsRepo, projects as projectsRepo, shots as shotsRepo } from '../db';
import { applyBreakdown, generateBreakdown } from '../ai/breakdown';
import { generateScript } from '../ai/script';
import { currentVideoModel } from '../system';
import { enqueueMissingReferences } from './references';
import type { Project } from '../../shared/types';

export interface AutopilotParams {
  /** The idea to break down; defaults to the project's script. */
  script?: string;
}

/** A fresh chain id for one autopilot run, so its jobs never jump ahead of each other in the GPU queue. */
export function autopilotChainId(jobId: string): string {
  return `autopilot:${jobId}`;
}

registerRunner('autopilot', async (job, ctx) => {
  const projectId = job.projectId;
  if (!projectId) throw new Error('Autopilot needs a project');
  const project = projectsRepo.get(projectId);
  if (!project) throw new Error('Project not found');
  const params = job.params as AutopilotParams;
  const idea = String(params.script ?? project.script ?? '').trim();
  if (!idea) throw new Error('This film has no idea or script to break down');

  // Write the full script first, so the film has an editable screenplay (not just the one-line idea).
  // If the writer fails, fall back to the idea: the breakdown can plan from a loose idea too.
  let script = idea;
  let scriptSaved = false;
  try {
    ctx.setProgress(0.02, 'Writing the script');
    const written = await generateScript({ prompt: idea, name: project.name, logline: project.logline, aspect: project.aspect });
    script = written.script;
    projectsRepo.update(projectId, { script });
    scriptSaved = true;
  } catch (err) {
    console.warn(`Autopilot script writer failed, breaking down the idea instead: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!scriptSaved && script !== project.script) projectsRepo.update(projectId, { script });

  ctx.setProgress(0.15, 'Planning scenes and shots');
  const draft = await generateBreakdown({
    script,
    existingCharacters: charactersRepo.list().map((c) => ({ name: c.name, description: c.description })),
    existingLocations: locationsRepo.list().map((l) => ({ name: l.name, description: l.description })),
    videoModel: await currentVideoModel(ctx.comfy),
  });
  ctx.setProgress(0.3, 'Building the storyboard');
  const detail = applyBreakdown(projectId, draft);
  const scenes = detail.scenes;
  const allShots = scenes.flatMap((s) => s.shots);

  // The chain id keeps refs → scene concepts → keyframes in FIFO order even when the GPU already has a
  // different model loaded (normally the scheduler may reorder jobs to reuse it; see pickNext).
  const chainId = autopilotChainId(job.id);
  const chain = { chainId };
  ctx.setProgress(0.4, 'Queueing reference images');

  const referenceJobs = enqueueMissingReferences(detail.project, allShots, chainId);

  ctx.setProgress(0.55, 'Queueing a still for every scene');
  for (const scene of scenes) {
    enqueue({
      type: 'scene_concept',
      title: `Scene still: ${scene.title}`,
      params: { sceneId: scene.id, ...chain },
      projectId,
    });
  }

  ctx.setProgress(0.75, 'Queueing shot keyframes');
  for (const shot of allShots) {
    shotsRepo.update(shot.id, { status: 'keyframe_queued' });
    enqueue({
      type: 'shot_keyframe',
      title: `Keyframe: scene ${scenes.findIndex((s) => s.id === shot.sceneId) + 1}, shot ${shot.order + 1}`,
      params: { shotId: shot.id, sceneId: shot.sceneId, ...chain },
      projectId,
      shotId: shot.id,
    });
  }
  ctx.setProgress(1, `Queued ${referenceJobs.length} reference${referenceJobs.length === 1 ? '' : 's'}, ${scenes.length} scene still${scenes.length === 1 ? '' : 's'} and ${allShots.length} keyframe${allShots.length === 1 ? '' : 's'}`);
});

/** Enqueue an autopilot run for a project (the route uses this too). */
export function queueAutopilot(project: Project, script?: string) {
  return enqueue({
    type: 'autopilot',
    title: `Make the film: ${project.name}`,
    params: { script: script?.trim() || project.script },
    projectId: project.id,
  });
}
