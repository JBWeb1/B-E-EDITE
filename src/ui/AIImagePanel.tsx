import { useState } from 'react';
import { aiProvider, imageSizeFor } from '../lib/aiService';

const STYLES = [
  { label: 'Photo', add: 'realistic photo, natural light, high detail' },
  { label: 'Illustration', add: 'flat vector illustration, clean shapes, bold colours' },
  { label: '3D', add: '3D render, soft studio lighting, glossy' },
  { label: 'Watercolour', add: 'watercolour painting, soft textured paper' },
  { label: 'Anime', add: 'anime style, cel shading, vibrant' },
  { label: 'None', add: '' },
];

/** Make a picture from a description (needs an AI service key). */
export function AIImagePanel({ aspect, onImage }: { aspect: number; onImage: (file: File, prompt: string) => Promise<void> | void }) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const make = async () => {
    setError('');
    setBusy(0);
    try {
      const full = [prompt.trim(), STYLES[style].add].filter(Boolean).join(', ');
      const blob = await aiProvider().image(full, imageSizeFor(aspect), (f) => setBusy(f));
      const name = prompt.trim().replace(/[^\w\- ]+/g, '').slice(0, 40) || 'AI image';
      await onImage(new File([blob], `AI image ${name}.png`, { type: blob.type || 'image/png' }), prompt.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the picture');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="ai-image">
      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the picture, e.g. “a cosy coffee shop on a rainy evening”" aria-label="Describe the picture" />
      <div className="chips" role="group" aria-label="Picture style">
        {STYLES.map((s, i) => (
          <button key={s.label} className={`chip ${style === i ? 'active' : ''}`} onClick={() => setStyle(i)} aria-pressed={style === i}>
            {s.label}
          </button>
        ))}
      </div>
      <button className="primary block" onClick={() => void make()} disabled={!prompt.trim() || busy !== null}>
        {busy !== null ? `Making it… ${Math.round(busy * 100)}%` : '✨ Make picture'}
      </button>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
