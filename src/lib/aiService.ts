/**
 * Speech-to-text, translation and text-to-speech for the AI tools.
 *
 * Two engines:
 * - "device": free and private. Whisper (speech-to-text) and MMS (voices) run in the
 *   browser with transformers.js, downloaded from a CDN the first time; translation
 *   uses the browser's built-in translator (Chrome) when it has one.
 * - "api": an OpenAI-compatible service with the user's own key. The key is kept only
 *   in this browser (localStorage) and sent only to the address the user typed.
 *
 * Tests (and other apps) can swap any part by setting `window.__beeAI`.
 */
import type { SpeechSegment } from '../video/ai';
import { groupWords } from '../video/transcript';

export type AIEngine = 'device' | 'api';

export interface AISettings {
  engine: AIEngine;
  apiKey: string;
  baseUrl: string;
  /** Voice name for the API voice-over (alloy, nova, onyx, …). */
  voice: string;
}

export interface AIProvider {
  /** Mono 16 kHz samples → timed text. `language` is a two-letter code or '' to detect. */
  transcribe(samples: Float32Array, language: string, onProgress?: (f: number) => void): Promise<SpeechSegment[]>;
  translate(texts: string[], from: string, to: string, onProgress?: (f: number) => void): Promise<string[]>;
  /** Spoken audio file for `text`. */
  speak(text: string, language: string, onProgress?: (f: number) => void): Promise<Blob>;
  /** How much each pixel belongs to a person in the picture (0..255, one byte per pixel). */
  segment(image: ImageData, onProgress?: (f: number) => void): Promise<Uint8Array>;
}

const KEY = 'bee.ai';
const DEFAULTS: AISettings = { engine: 'device', apiKey: '', baseUrl: 'https://api.openai.com/v1', voice: 'nova' };

export function loadAISettings(): AISettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function saveAISettings(s: AISettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings last for this visit only */
  }
}

export const API_VOICES = ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer'];

// ---------- On-device models (transformers.js) ----------

export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = (input: any, opts?: any) => Promise<any>;
const pipelines = new Map<string, Promise<Pipeline>>();

function devicePipeline(task: string, model: string, onProgress?: (f: number) => void): Promise<Pipeline> {
  const id = `${task}:${model}`;
  if (!pipelines.has(id)) {
    const loading = (async () => {
      const lib = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      const files = new Map<string, number>();
      return lib.pipeline(task, model, {
        progress_callback: (p: { status: string; file?: string; progress?: number }) => {
          if (p.status === 'progress' && p.file) {
            files.set(p.file, (p.progress ?? 0) / 100);
            onProgress?.([...files.values()].reduce((a, b) => a + b, 0) / files.size);
          }
        },
      }) as Promise<Pipeline>;
    })();
    loading.catch(() => pipelines.delete(id));
    pipelines.set(id, loading);
  }
  return pipelines.get(id)!;
}

/** MMS voices for the languages we offer (one small model per language). */
const MMS: Record<string, string> = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', nl: 'nld', pl: 'pol',
  tr: 'tur', ru: 'rus', uk: 'ukr', ar: 'ara', hi: 'hin', ja: 'jpn', ko: 'kor', zh: 'cmn',
};

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorFactory {
  create(opts: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }): Promise<BrowserTranslator>;
  availability?(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
}

/** The browser's own translator (Chrome 138+), if it has one. */
const browserTranslator = (): TranslatorFactory | undefined => (globalThis as { Translator?: TranslatorFactory }).Translator;

export const hasBrowserTranslator = () => !!browserTranslator();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let matting: Promise<{ lib: any; model: any; processor: any }> | null = null;

/** MODNet portrait matting (about 25 MB, cached by the browser): cuts people out of any background. */
async function deviceSegment(image: ImageData, onProgress?: (f: number) => void): Promise<Uint8Array> {
  if (!matting) {
    matting = (async () => {
      const lib = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      const files = new Map<string, number>();
      const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress' && p.file) {
          files.set(p.file, (p.progress ?? 0) / 100);
          onProgress?.(([...files.values()].reduce((a, b) => a + b, 0) / files.size) * 0.9);
        }
      };
      const model = await lib.AutoModel.from_pretrained('Xenova/modnet', { dtype: 'fp32', progress_callback });
      const processor = await lib.AutoProcessor.from_pretrained('Xenova/modnet');
      return { lib, model, processor };
    })();
    matting.catch(() => (matting = null));
  }
  const { lib, model, processor } = await matting;
  const raw = new lib.RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 4);
  const { pixel_values } = await processor(raw);
  const { output } = await model({ input: pixel_values });
  const mask = await lib.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height);
  onProgress?.(1);
  return new Uint8Array(mask.data);
}

const deviceProvider: AIProvider = {
  async transcribe(samples, language, onProgress) {
    // Multilingual tiny Whisper: about 40 MB, cached by the browser after the first use.
    const asr = await devicePipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', (f) => onProgress?.(f * 0.5));
    onProgress?.(0.55);
    // Word timings, so the transcript can cut single words (filler words, mistakes).
    const out = await asr(samples, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: 'transcribe' } : {}),
    });
    onProgress?.(1);
    const chunks: { timestamp: [number, number | null]; text: string }[] = out.chunks ?? [];
    const end = samples.length / 16000;
    const words = chunks.map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? Math.min(end, (c.timestamp[0] ?? 0) + 0.4), text: c.text }));
    return groupWords(words);
  },
  async translate(texts, from, to, onProgress) {
    const factory = browserTranslator();
    if (!factory) throw new Error('This browser has no built-in translator. Use Chrome, or add an API key in AI settings.');
    const tr = await factory.create({ sourceLanguage: from, targetLanguage: to });
    const out: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(await tr.translate(texts[i]));
      onProgress?.((i + 1) / texts.length);
    }
    return out;
  },
  async speak(text, language, onProgress) {
    const code = MMS[language] ?? 'eng';
    const tts = await devicePipeline('text-to-speech', `Xenova/mms-tts-${code}`, (f) => onProgress?.(f * 0.8));
    const out = await tts(text);
    onProgress?.(1);
    return new Blob([floatToWav(out.audio as Float32Array, out.sampling_rate as number)], { type: 'audio/wav' });
  },
  segment: deviceSegment,
};

// ---------- API (OpenAI-compatible) ----------

function apiProvider(s: AISettings): AIProvider {
  const base = s.baseUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${s.apiKey}` };
  const fail = async (r: Response) => {
    let msg = `${r.status} ${r.statusText}`;
    try {
      msg = (await r.json()).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`The AI service said: ${msg}`);
  };
  return {
    async transcribe(samples, language, onProgress) {
      const form = new FormData();
      form.append('file', new Blob([floatToWav(samples, 16000)], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      form.append('timestamp_granularities[]', 'word');
      if (language) form.append('language', language);
      onProgress?.(0.2);
      const r = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers, body: form });
      if (!r.ok) await fail(r);
      const data = await r.json();
      onProgress?.(1);
      const words: { start: number; end: number; text: string }[] = (data.words ?? []).map((w: { word: string; start: number; end: number }) => ({ start: w.start, end: w.end, text: w.word }));
      const segments: SpeechSegment[] = (data.segments ?? []).map((g: SpeechSegment) => ({
        start: g.start,
        end: g.end,
        text: g.text,
        words: words.filter((w) => w.start >= g.start - 0.01 && w.start < g.end),
      }));
      return segments.length ? segments : [{ start: 0, end: samples.length / 16000, text: data.text ?? '' }];
    },
    async translate(texts, from, to, onProgress) {
      onProgress?.(0.2);
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `Translate video captions${from ? ` from ${from}` : ''} to the language with code "${to}". Keep them short and natural. Reply as JSON {"lines": [...]} with exactly one line per input line, in order.` },
            { role: 'user', content: JSON.stringify({ lines: texts }) },
          ],
        }),
      });
      if (!r.ok) await fail(r);
      const lines: string[] = JSON.parse((await r.json()).choices[0].message.content).lines ?? [];
      onProgress?.(1);
      return texts.map((t, i) => lines[i] ?? t);
    },
    async speak(text, _language, onProgress) {
      onProgress?.(0.2);
      const r = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', voice: s.voice, input: text, response_format: 'mp3' }),
      });
      if (!r.ok) await fail(r);
      onProgress?.(1);
      return new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
    },
    // Cut-outs always run on this device (there is no standard API for them).
    segment: deviceSegment,
  };
}

/** The provider to use now, honouring the settings and any test override. */
export function aiProvider(s: AISettings = loadAISettings()): AIProvider {
  const chosen = s.engine === 'api' && s.apiKey ? apiProvider(s) : deviceProvider;
  const override = (globalThis as { __beeAI?: Partial<AIProvider> }).__beeAI;
  return override ? { ...chosen, ...override } : chosen;
}

/** Mono 16-bit WAV file from float samples. */
export function floatToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return buf;
}

/** Decode the sound of a media file to mono samples at `sampleRate` (16 kHz for speech). */
export async function decodeMono(url: string, sampleRate = 16000): Promise<Float32Array | null> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    const buf = await ctx.decodeAudioData(data);
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } catch {
    return null; // no sound track
  }
}
