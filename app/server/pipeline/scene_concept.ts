// 'scene_concept' job: one establishing/concept still per scene. It is the storyboard's cover image and the
// visual anchor every shot keyframe in that scene composes from, so place, light and cast stay consistent.
import { registerRunner } from './queue';
import {
  assets as assetsRepo,
  characters as charactersRepo,
  locations as locationsRepo,
  projects as projectsRepo,
  scenes as scenesRepo,
  shots as shotsRepo,
  styles as stylesRepo,
} from '../db';
import { emit } from '../events';
import { buildQwenEdit, buildZImage } from '../comfy/workflows';
import { sceneCastIds } from './reference_sheet';
import { IMAGE_SIZES } from '../../shared/presets';
import { resolveSeed, saveComfyOutput, uploadAssetToComfy } from './media';
import { isEngineAvailable } from '../system';
import { buildSceneConceptPrompt } from './scene_concept_prompt';
import type { Character, ID, Scene, Shot } from '../../shared/types';

/** A scene concept and the shots it anchors, loaded once for both the render and its prompt. */
export function loadSceneConceptContext(sceneId: ID): {
  scene: Scene;
  project: NonNullable<ReturnType<typeof projectsRepo.get>>;
  location: ReturnType<typeof locationsRepo.get>;
  cast: Character[];
  shots: Shot[];
  referenceCharacters: Character[];
  stylePrompt: string;
} {
  const scene = scenesRepo.get(sceneId);
  if (!scene) throw new Error('Scene not found');
  const project = projectsRepo.get(scene.projectId);
  if (!project) throw new Error('Project not found');
  const location = scene.locationId ? locationsRepo.get(scene.locationId) : undefined;
  const shots = shotsRepo.listByScene(scene.id);
  const castIds = sceneCastIds(scene, shots);
  const cast = castIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  // Qwen-Image-Edit takes at most 3 images and the location establishing plate is the first, so two cast refs.
  const referenceCharacters = cast.filter((c) => c.referenceAssetIds.length > 0).slice(0, 2);
  const style = project.styleId ? stylesRepo.get(project.styleId) : undefined;
  return { scene, project, location, cast, shots, referenceCharacters, stylePrompt: style?.prompt ?? '' };
}

registerRunner('scene_concept', async (job, ctx) => {
  const params = job.params as { sceneId?: string };
  const sceneId = String(params.sceneId ?? '');
  const { scene, project, location, cast, referenceCharacters, stylePrompt } = loadSceneConceptContext(sceneId);
  const seed = resolveSeed();
  const size = IMAGE_SIZES[project.aspect];

  // Qwen-Image-Edit keeps the canvas aspect of its first image, so the concept uses the location's
  // establishing plate (already at the project aspect) rather than a square cast reference sheet.
  const canEdit =
    referenceCharacters.length > 0 &&
    Boolean(location?.establishingAssetId) &&
    (await isEngineAvailable(ctx.comfy, 'qwen_edit'));
  const prompt = buildSceneConceptPrompt({
    scene,
    locationDescription: location?.description,
    cast,
    stylePrompt,
    hasReferenceImages: canEdit,
  });
  let file;
  if (canEdit) {
    const establishing = assetsRepo.get(location!.establishingAssetId!);
    if (!establishing) throw new Error('Location establishing asset is missing on disk');
    const images = [await uploadAssetToComfy(ctx.comfy, establishing)];
    for (const c of referenceCharacters) {
      const asset = assetsRepo.get(c.referenceAssetIds[0]!);
      if (asset) images.push(await uploadAssetToComfy(ctx.comfy, asset));
    }
    ctx.setProgress(0.15, 'Placing the cast in the scene');
    const workflow = buildQwenEdit({ images, prompt, seed });
    const promptId = await ctx.comfy.queuePrompt(workflow);
    await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(0.15 + frac * 0.85, 'Rendering scene concept'));
    file = (await ctx.comfy.getOutputs(promptId))[0];
  } else {
    ctx.setProgress(0.1, 'Rendering scene concept');
    const workflow = buildZImage({ prompt, width: size.width, height: size.height, seed, batch: 1 });
    const promptId = await ctx.comfy.queuePrompt(workflow);
    await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(0.1 + frac * 0.9, 'Rendering scene concept'));
    file = (await ctx.comfy.getOutputs(promptId))[0];
  }
  if (!file) throw new Error('No scene concept produced');

  const asset = await saveComfyOutput(ctx.comfy, file, {
    origin: 'generated',
    prompt,
    engine: canEdit ? 'qwen_edit' : 'zimage',
    params: { sceneId, seed },
    jobId: job.id,
    projectId: scene.projectId,
  });
  ctx.addOutput(asset.id);
  const updated = scenesRepo.update(sceneId, { conceptAssetId: asset.id });
  if (updated) emit({ type: 'scene', scene: updated });
});
