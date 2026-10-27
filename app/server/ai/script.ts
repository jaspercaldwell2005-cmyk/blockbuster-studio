// AI script writer: a quick idea/prompt -> a complete, production-ready short-film script.
// The Script tab uses this before the breakdown, so the user reviews and edits a real script
// (rather than a one-line idea) and the storyboard scenes come from it.
import { z } from 'zod';
import { callLlmForJson } from './llm';
import type { AspectRatio } from '../../shared/types';

export interface GenerateScriptOpts {
  /** The user's quick idea, a line or a short paragraph. */
  prompt: string;
  /** Working title, if the project already has one. */
  name?: string;
  /** The project's existing logline, as context (not a constraint). */
  logline?: string;
  /** The project's frame: useful for composing vertical films. */
  aspect?: AspectRatio;
}

export interface ScriptDraft {
  logline: string;
  script: string;
}

const ScriptDraftSchema = z.object({
  logline: z.string().catch(''),
  script: z.string().trim().min(1),
});

const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    logline: { type: 'string', description: 'One sentence, at most 30 words.' },
    script: {
      type: 'string',
      description:
        'The complete screenplay in standard format: scene headings, action, character cues and dialogue. The full text, never an outline or summary.',
    },
  },
  required: ['logline', 'script'],
} as const;

/** True for 9:16, 3:4, 4:5, 2:3: the frame is taller than it is wide. */
function isVertical(aspect: AspectRatio): boolean {
  const [w, h] = aspect.split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && h > w;
}

export function buildScriptUserPrompt(opts: GenerateScriptOpts): string {
  const lines: string[] = [];
  if (opts.name?.trim()) lines.push(`Working title: ${opts.name.trim()}`);
  if (opts.logline?.trim()) lines.push(`Existing logline (use it as a starting point, improve it if needed): ${opts.logline.trim()}`);
  if (opts.aspect) {
    lines.push(`Frame: ${opts.aspect}${isVertical(opts.aspect) ? ' — vertical, so compose action for a tall frame' : ''}`);
  }
  lines.push(`The quick idea:\n${opts.prompt.trim()}`);
  return lines.join('\n\n');
}

export async function generateScript(opts: GenerateScriptOpts): Promise<ScriptDraft> {
  if (!opts.prompt.trim()) throw new Error('A quick prompt is needed to write the script');

  const system = `You are a screenwriter writing a short film for an AI film production pipeline. Turn the user's quick idea into a complete, vivid, shootable script.

Rules:
- Write a real screenplay, roughly 1–3 pages and 6–12 shots' worth of story. Use scene headings (INT./EXT. LOCATION - DAY/NIGHT), present-tense action, CHARACTER CUES and dialogue.
- Ground every scene in a specific place and time of day, and make every moment visually concrete so it can be drawn as a still.
- Keep the cast to 1–4 characters and the story to 1–3 locations so a small production can actually shoot it.
- Give it a clear beginning, turn and ending. Prefer one strong visual idea over many subplots.
- Do not include camera directions, shot numbers, montage notes or production notes; a separate breakdown plans coverage.
- Return the full script itself, never an outline, treatment or summary, and no preamble outside the script.
- Also return one logline of at most 30 words.`;

  const raw = await callLlmForJson({
    system,
    user: buildScriptUserPrompt(opts),
    toolName: 'submit_script',
    toolDescription: 'Submit the finished short-film script and its logline.',
    schema: SCRIPT_JSON_SCHEMA,
  });

  const parsed = ScriptDraftSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The AI returned a script that could not be parsed');
  return { logline: parsed.data.logline.trim(), script: parsed.data.script.trim() };
}
