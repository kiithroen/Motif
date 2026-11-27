import { describe, expect, it, vi } from 'vitest';
import { GeminiCoachError, maskApiKey, requestGeminiCoach } from '../src/ai/geminiCoach';
import { analyzeSong } from '../src/core/analyzer';
import { COACH_CONFIG } from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';

function createBaseArgs() {
  const project = createDefaultProject();
  const compiled = compileSong(project);
  const report = analyzeSong(compiled, project);
  return { project, compiled, report };
}

describe('geminiCoach REST adapter', () => {
  it('sends structured generateContent request and parses valid Gemini response', async () => {
    const { project, compiled, report } = createBaseArgs();
    const altGroove = PRESETS.grooves[1].id;

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    text: '내부 사고 과정: 로파이 그루브와 iv 대리화음을 선택하자.',
                  },
                  {
                    text: JSON.stringify({
                      headline: '따뜻한 로파이 분위기 적용',
                      explanation: '리듬을 여유로운 그루브로 바꾸고 마지막 마디에 여운을 더했습니다.',
                      patch: {
                        bpm: 78,
                        blocks: { grooveId: altGroove },
                        chords: [{ bar: 4, degree: 'iv' }],
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const result = await requestGeminiCoach({
      settings: {
        apiKey: 'AIzaTestSecretKey123456',
        model: COACH_CONFIG.defaultModel,
      },
      mode: 'request',
      userRequest: '로파이 느낌으로 바꿔 줘',
      project,
      compiled,
      report,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`${COACH_CONFIG.defaultModel}:generateContent?key=AIzaTestSecretKey123456`);
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });

    const sentBody = JSON.parse(String(init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: {
        responseMimeType: string;
        responseJsonSchema: { type: string; additionalProperties: boolean };
        maxOutputTokens: number;
        thinkingConfig: { thinkingLevel: string };
      };
    };
    expect(sentBody.generationConfig.responseMimeType).toBe('application/json');
    expect(sentBody.generationConfig.responseJsonSchema.type).toBe('object');
    expect(sentBody.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(sentBody.generationConfig.maxOutputTokens).toBe(COACH_CONFIG.generation.maxOutputTokens);
    expect(sentBody.generationConfig.thinkingConfig.thinkingLevel).toBe(
      COACH_CONFIG.generation.thinkingLevel
    );
    expect(sentBody.systemInstruction.parts[0].text.length).toBeGreaterThan(20);

    expect(result.response.headline).toBe('따뜻한 로파이 분위기 적용');
    expect(result.response.patch?.blocks?.grooveId).toBe(altGroove);
    expect(result.response.patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);
  });

  it('handles missing key, HTTP auth/rate errors, and invalid payload without leaking API key', async () => {
    const { project, compiled, report } = createBaseArgs();
    const secretKey = 'AIzaSuperSecretKey9999';

    await expect(
      requestGeminiCoach({
        settings: { apiKey: '   ', model: COACH_CONFIG.defaultModel },
        mode: 'explain',
        project,
        compiled,
        report,
      })
    ).rejects.toThrow(GeminiCoachError);

    const authFailFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: `Invalid key ${secretKey}` } }), { status: 403 })
    );

    let authErr: unknown;
    try {
      await requestGeminiCoach({
        settings: { apiKey: secretKey, model: COACH_CONFIG.defaultModel },
        mode: 'explain',
        project,
        compiled,
        report,
        fetchImpl: authFailFetch,
      });
    } catch (err) {
      authErr = err;
    }
    expect(authErr).toBeInstanceOf(GeminiCoachError);
    expect((authErr as GeminiCoachError).status).toBe(403);
    expect((authErr as Error).message).not.toContain(secretKey);

    const rateFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 })
    );
    await expect(
      requestGeminiCoach({
        settings: { apiKey: secretKey, model: COACH_CONFIG.defaultModel },
        mode: 'explain',
        project,
        compiled,
        report,
        fetchImpl: rateFetch,
      })
    ).rejects.toMatchObject({ status: 429 });

    const emptyCandidateFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    );
    await expect(
      requestGeminiCoach({
        settings: { apiKey: secretKey, model: COACH_CONFIG.defaultModel },
        mode: 'explain',
        project,
        compiled,
        report,
        fetchImpl: emptyCandidateFetch,
      })
    ).rejects.toThrow(GeminiCoachError);

    expect(maskApiKey('AIza1234567890')).toBe('AIza...7890');
    expect(maskApiKey('short')).toBe('****');
  });
});
