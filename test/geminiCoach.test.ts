import { describe, expect, it, vi } from 'vitest';
import { GeminiCoachError, maskApiKey, requestGeminiCoach } from '../src/ai/geminiCoach';
import { analyzeSong } from '../src/core/analyzer';
import { COACH_CONFIG, getMaxDemoChords } from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { createDefaultProject } from '../src/core/model';

function createBaseArgs() {
  const project = createDefaultProject();
  const compiled = compileSong(project);
  const report = analyzeSong(compiled, project);
  return { project, compiled, report };
}

describe('geminiCoach REST adapter', () => {
  it('sends structured generateContent request and parses valid tutor response', async () => {
    const { project, compiled, report } = createBaseArgs();
    project.bars = 8;

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    text: '내부 사고 과정: 4마디 iv 비교 예시와 8마디 멜로디 대안을 안내하자.',
                  },
                  {
                    text: JSON.stringify({
                      headline: '4마디에 아련한 여운 더하기',
                      explanation: '4마디의 IV 코드를 같은 루트의 마이너 iv로 바꾸면 색채가 부드럽게 가라앉습니다.',
                      manualSteps: ['L2 변형 체인 탭에서 4마디 코드를 iv로 바꿔 들어 보세요.'],
                      patch: {
                        chords: [{ bar: 4, degree: 'iv' }],
                        melodyBars: [
                          {
                            bar: 8,
                            notes: [{ stepInBar: 0, midi: 72, duration: 8 }],
                          },
                        ],
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
      userRequest: '3~4마디 여운 더하는 이론 알려줘',
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
        responseJsonSchema: {
          type: string;
          additionalProperties: boolean;
          properties: { patch: { properties: { chords: { maxItems: number } } } };
        };
        maxOutputTokens: number;
        thinkingConfig: { thinkingLevel: string };
      };
    };
    expect(sentBody.generationConfig.responseMimeType).toBe('application/json');
    expect(sentBody.generationConfig.responseJsonSchema.type).toBe('object');
    expect(sentBody.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(sentBody.generationConfig.responseJsonSchema.properties.patch.properties.chords.maxItems).toBe(
      getMaxDemoChords(8)
    );
    expect(sentBody.generationConfig.maxOutputTokens).toBe(COACH_CONFIG.generation.maxOutputTokens);
    expect(sentBody.generationConfig.thinkingConfig.thinkingLevel).toBe(
      COACH_CONFIG.generation.thinkingLevel
    );
    expect(sentBody.systemInstruction.parts[0].text.length).toBeGreaterThan(20);

    expect(result.response.headline).toBe('4마디에 아련한 여운 더하기');
    expect(result.response.manualSteps).toEqual(['L2 변형 체인 탭에서 4마디 코드를 iv로 바꿔 들어 보세요.']);
    expect(result.response.patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);
    expect(result.response.patch?.melodyBars?.[0].bar).toBe(8);
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
