import type { DiagnosisReport } from '../core/analyzer';
import {
  COACH_CONFIG,
  type CoachResponse,
  buildCoachContext,
  buildCoachResponseSchema,
  buildCoachSystemPrompt,
  buildCoachUserPrompt,
  parseCoachResponse,
} from '../core/coachPatch';
import type { CompiledSong } from '../core/compiler';
import type { SongProject } from '../core/model';

export const GEMINI_SETTINGS_STORAGE_KEY = 'motif_gemini_coach_v1';

export interface GeminiCoachSettings {
  apiKey: string;
  model: string;
  endpointBaseUrl?: string;
}

export interface RequestGeminiCoachOptions {
  settings: GeminiCoachSettings;
  mode: 'explain' | 'request';
  userRequest?: string;
  project: SongProject;
  compiled: CompiledSong;
  report: DiagnosisReport;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface GeminiCoachResult {
  response: CoachResponse;
  warnings: string[];
  model: string;
}

export class GeminiCoachError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiCoachError';
    this.status = status;
  }
}

function getEnvApiKey(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
    if (env && typeof env.VITE_GEMINI_API_KEY === 'string') {
      return env.VITE_GEMINI_API_KEY.trim();
    }
  } catch {
    // Node/비-Vite 환경에서는 환경변수가 없을 수 있다.
  }
  return '';
}

function resolveValidModel(model: unknown): string {
  if (typeof model === 'string' && COACH_CONFIG.models.some((m) => m.id === model)) {
    return model;
  }
  return COACH_CONFIG.defaultModel;
}

export function loadGeminiSettings(): GeminiCoachSettings {
  const fallbackKey = getEnvApiKey();
  try {
    const raw = localStorage.getItem(GEMINI_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GeminiCoachSettings>;
      const storedKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
      return {
        apiKey: storedKey || fallbackKey,
        model: resolveValidModel(parsed.model),
        endpointBaseUrl:
          typeof parsed.endpointBaseUrl === 'string' && parsed.endpointBaseUrl.trim().length > 0
            ? parsed.endpointBaseUrl.trim()
            : undefined,
      };
    }
  } catch {
    // 저장 불가 환경 또는 파싱 실패 시 기본 설정을 반환한다.
  }
  return {
    apiKey: fallbackKey,
    model: COACH_CONFIG.defaultModel,
  };
}

export function saveGeminiSettings(settings: GeminiCoachSettings): void {
  const payload: GeminiCoachSettings = {
    apiKey: settings.apiKey.trim(),
    model: resolveValidModel(settings.model),
  };
  if (settings.endpointBaseUrl && settings.endpointBaseUrl.trim().length > 0) {
    payload.endpointBaseUrl = settings.endpointBaseUrl.trim();
  }
  try {
    localStorage.setItem(GEMINI_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 프라이빗 모드 등 저장 불가 환경은 건너뛴다.
  }
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function mapHttpError(status: number, apiMessage?: string): GeminiCoachError {
  if (status === 400 || status === 401 || status === 403) {
    return new GeminiCoachError(
      'API 키가 올바르지 않거나 Gemini API 사용 권한이 없다. 키를 다시 확인해 주세요.',
      status
    );
  }
  if (status === 429) {
    return new GeminiCoachError(
      '요청 한도를 초과했다. 잠시 기다린 뒤 다시 시도해 주세요.',
      status
    );
  }
  if (status >= 500 && status <= 599) {
    return new GeminiCoachError(
      'Gemini 서버 응답이 지연되고 있다. 잠시 후 다시 시도해 주세요.',
      status
    );
  }
  const detail = apiMessage ? ` (${apiMessage})` : '';
  return new GeminiCoachError(`Gemini 요청에 실패했다 (HTTP ${status})${detail}`, status);
}

function sanitizeErrorMessage(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join('[REDACTED]');
}

export async function requestGeminiCoach(options: RequestGeminiCoachOptions): Promise<GeminiCoachResult> {
  const apiKey = options.settings.apiKey.trim();
  if (!apiKey) {
    throw new GeminiCoachError('Gemini API 키를 먼저 입력해 주세요.');
  }

  const trimmedRequest = (options.userRequest ?? '').trim().slice(0, COACH_CONFIG.limits.maxPromptLength);
  if (options.mode === 'request' && !trimmedRequest) {
    throw new GeminiCoachError('원하는 분위기나 수정 요청을 입력해 주세요.');
  }

  const model = resolveValidModel(options.settings.model);
  const baseUrl = (options.settings.endpointBaseUrl ?? COACH_CONFIG.apiBaseUrl).replace(/\/+$/, '');
  const url = `${baseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const context = buildCoachContext(options.project, options.compiled, options.report);
  const systemPrompt = buildCoachSystemPrompt(options.project.bars);
  const userPrompt = buildCoachUserPrompt(context, options.mode, trimmedRequest);

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: COACH_CONFIG.generation.maxOutputTokens,
    responseMimeType: 'application/json',
    responseJsonSchema: buildCoachResponseSchema(options.project.bars),
    thinkingConfig: {
      thinkingLevel: COACH_CONFIG.generation.thinkingLevel,
    },
  };
  if (COACH_CONFIG.generation.temperature !== undefined) {
    generationConfig.temperature = COACH_CONFIG.generation.temperature;
  }

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig,
  };

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new GeminiCoachError('이 환경에서는 fetch 네트워크 요청을 사용할 수 없다.');
  }

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    throw new GeminiCoachError('네트워크 연결에 실패했다. 인터넷 연결이나 방화벽 상태를 확인해 주세요.');
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    if (!res.ok) {
      throw mapHttpError(res.status);
    }
    throw new GeminiCoachError('Gemini 서버에서 올바른 JSON 응답을 받지 못했다.', res.status);
  }

  if (!res.ok) {
    const apiErrMsg =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
        ? sanitizeErrorMessage((payload as { error: { message: string } }).error.message, apiKey)
        : undefined;
    throw mapHttpError(res.status, apiErrMsg);
  }

  const candidates =
    typeof payload === 'object' && payload !== null && 'candidates' in payload
      ? (
          payload as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
              finishReason?: string;
            }>;
          }
        ).candidates
      : undefined;

  const firstCandidate = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = firstCandidate?.content?.parts;
  const combinedText = Array.isArray(parts)
    ? parts
        .filter((p) => !p?.thought && typeof p?.text === 'string')
        .map((p) => p.text as string)
        .join('')
        .trim()
    : '';

  if (!combinedText) {
    throw new GeminiCoachError('Gemini 가 빈 응답을 돌려줬다. 요청을 조금 바꿔 다시 시도해 주세요.');
  }

  try {
    const { response, warnings } = parseCoachResponse(combinedText, options.project.bars);
    return { response, warnings, model };
  } catch (err) {
    const msg = err instanceof Error ? sanitizeErrorMessage(err.message, apiKey) : '코치 응답 해석에 실패했다.';
    throw new GeminiCoachError(msg);
  }
}
