import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./llm', () => ({ callLlmForJson: vi.fn() }));

const { buildScriptUserPrompt, generateScript } = await import('./script');
const { callLlmForJson } = await import('./llm');

describe('buildScriptUserPrompt', () => {
  it('includes the project context and the quick idea', () => {
    const prompt = buildScriptUserPrompt({
      prompt: 'A courier finds her last delivery is a bomb.',
      name: 'Last Delivery',
      logline: 'One final run across Tokyo.',
      aspect: '9:16',
    });
    expect(prompt).toContain('Working title: Last Delivery');
    expect(prompt).toContain('One final run across Tokyo.');
    expect(prompt).toContain('9:16');
    expect(prompt).toContain('vertical');
    expect(prompt).toContain('A courier finds her last delivery is a bomb.');
  });

  it('works with just a quick prompt', () => {
    expect(buildScriptUserPrompt({ prompt: '  A ghost haunts a laundromat.  ' })).toBe('The quick idea:\nA ghost haunts a laundromat.');
  });
});

describe('generateScript', () => {
  beforeEach(() => vi.mocked(callLlmForJson).mockReset());

  it('returns the trimmed logline and script', async () => {
    vi.mocked(callLlmForJson).mockResolvedValue({
      logline: '  A courier races to stop her own delivery.  ',
      script: '  INT. RAMEN BAR - NIGHT\n\nMara slides the envelope across the counter.  ',
    });
    const draft = await generateScript({ prompt: 'a courier story' });
    expect(draft.logline).toBe('A courier races to stop her own delivery.');
    expect(draft.script).toContain('INT. RAMEN BAR - NIGHT');
    expect(draft.script.endsWith('counter.')).toBe(true);
  });

  it('rejects a response with no script', async () => {
    vi.mocked(callLlmForJson).mockResolvedValue({ logline: 'A logline' });
    await expect(generateScript({ prompt: 'a courier story' })).rejects.toThrow('could not be parsed');
  });

  it('does not call the LLM with an empty prompt', async () => {
    await expect(generateScript({ prompt: '   ' })).rejects.toThrow('quick prompt');
    expect(callLlmForJson).not.toHaveBeenCalled();
  });
});
