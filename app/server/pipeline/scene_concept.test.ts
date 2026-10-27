import { describe, expect, it } from 'vitest';
import { buildSceneConceptPrompt } from './scene_concept_prompt';

describe('buildSceneConceptPrompt', () => {
  it('describes the place, time and cast as a cinematic establishing still', () => {
    const prompt = buildSceneConceptPrompt({
      scene: { title: 'INT. RAMEN BAR - NIGHT', description: 'Mara waits by the counter', timeOfDay: 'night' },
      locationDescription: 'a steamy neon-lit ramen bar',
      cast: [{ name: 'Mara', description: 'short black hair, red raincoat' }],
      stylePrompt: '35mm film, teal and orange',
    });
    expect(prompt).toContain('at night');
    expect(prompt).toContain('interior');
    expect(prompt).not.toContain('INT. RAMEN BAR - NIGHT'); // a slugline gets drawn as a sign
    expect(prompt).toContain('steamy neon-lit ramen bar');
    expect(prompt).toContain('Mara (short black hair, red raincoat)');
    expect(prompt).toContain('35mm film, teal and orange');
    expect(prompt).toContain('no text');
  });

  it('points at reference images when the cast is passed to the edit model', () => {
    const prompt = buildSceneConceptPrompt({
      scene: { title: 'EXT. ROOFTOP - DUSK', description: '', timeOfDay: 'dusk' },
      cast: [{ name: 'Jon', description: 'weathered face' }],
      hasReferenceImages: true,
    });
    expect(prompt).toContain('Keep the place exactly as shown in the first reference image');
    expect(prompt).toContain('The people from the other reference images');
    expect(prompt).toContain('Keep their faces');
  });
});
