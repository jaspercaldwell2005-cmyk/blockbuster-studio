// Pure prompt construction for a scene's concept/establishing still. Kept free of db/queue imports so it can
// be tested without a GPU or a database.
import type { Character, Scene } from '../../shared/types';

const TIME_OF_DAY_PHRASE: Record<string, string> = {
  dawn: 'at dawn',
  day: 'in daylight',
  'golden hour': 'at golden hour',
  dusk: 'at dusk',
  night: 'at night',
};

export interface SceneConceptInput {
  scene: Pick<Scene, 'title' | 'description' | 'timeOfDay'>;
  locationDescription?: string;
  cast: Pick<Character, 'name' | 'description'>[];
  stylePrompt?: string;
  /** True when the cast's reference images are passed to Qwen-Image-Edit, so the prompt can point at them. */
  hasReferenceImages?: boolean;
}

/** The text prompt for a scene's concept still. */
export function buildSceneConceptPrompt(input: SceneConceptInput): string {
  const time = TIME_OF_DAY_PHRASE[input.scene.timeOfDay] ?? input.scene.timeOfDay;
  const place = (input.locationDescription ?? input.scene.description ?? '').trim();
  const action = (input.scene.description ?? '').trim();
  // Never put the slugline in the prompt: image models render "INT. RAMEN BAR - NIGHT" as a giant sign.
  const interior = /^INT\./i.test(input.scene.title) ? 'interior ' : /^EXT\./i.test(input.scene.title) ? 'exterior ' : '';
  const cast = input.cast
    .map((c) => (c.description.trim() ? `${c.name} (${c.description.trim()})` : c.name))
    .join('; ');
  return [
    `Cinematic establishing still, ${interior}${time}.`,
    place ? `${place}.` : '',
    action && action !== place ? `${action}.` : '',
    cast
      ? input.hasReferenceImages
        ? `Keep the place exactly as shown in the first reference image. The people from the other reference images: ${cast}. Keep their faces, hair, body and clothing exactly as shown.`
        : `In frame: ${cast}.`
      : 'No people in frame.',
    input.stylePrompt?.trim() ? `${input.stylePrompt.trim()}.` : '',
    'Wide establishing composition, photorealistic, cinematic lighting, no text, no signs, no captions, no watermark.',
  ]
    .filter(Boolean)
    .join(' ');
}
