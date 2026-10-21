import { useRef, useState } from 'react';
import { addColors } from '../lib/brand';
import type { BrandKit } from '../lib/brand';
import { readFileAsDataURL } from '../lib/download';
import { FONTS } from '../design/model';
import { FontPicker } from './FontPicker';

/** Downscale a logo so the kit stays small enough to keep in the browser. */
async function shrink(src: string, max = 512): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1 && src.length < 300_000) return src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** Brand kit editor: colours, heading and body fonts, logos. */
export function BrandPanel({
  brand,
  setBrand,
  designColors,
  onLogo,
  onApply,
  applyLabel = 'Use brand fonts on this page',
}: {
  brand: BrandKit;
  setBrand: (b: BrandKit) => void;
  designColors: string[];
  onLogo: (src: string) => void;
  onApply?: () => void;
  applyLabel?: string;
}) {
  const [pick, setPick] = useState('#0ea5e9');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="brand-panel">
      <h3>Brand kit</h3>
      <p className="hint">Your colours, fonts and logos, ready in every design and video on this device.</p>

      <h4>Colours</h4>
      <div className="swatches brand-swatches">
        {brand.colors.map((c) => (
          <span key={c} className="brand-swatch">
            <span className="swatch" style={{ background: c }} title={c} />
            <button className="brand-remove" onClick={() => setBrand({ ...brand, colors: brand.colors.filter((x) => x !== c) })} aria-label={`Remove colour ${c}`} title="Remove">
              ×
            </button>
          </span>
        ))}
        {!brand.colors.length && <span className="hint">No colours yet.</span>}
      </div>
      <div className="row">
        <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Brand colour to add" />
        <button onClick={() => setBrand(addColors(brand, [pick]))}>Add colour</button>
        <button onClick={() => setBrand(addColors(brand, designColors))} disabled={!designColors.length} title="Add every colour used on this page">
          From this design
        </button>
      </div>

      <h4>Fonts</h4>
      <FontPicker label="Headings" value={brand.heading ?? 'Inter, sans-serif'} local={FONTS} onChange={(heading) => setBrand({ ...brand, heading })} />
      <FontPicker label="Body text" value={brand.body ?? 'Inter, sans-serif'} local={FONTS} onChange={(body) => setBrand({ ...brand, body })} />
      {onApply && (brand.heading || brand.body) && (
        <button className="block" onClick={onApply}>
          {applyLabel}
        </button>
      )}

      <h4>Logos</h4>
      <div className="grid2">
        {brand.logos.map((src, i) => (
          <span key={i} className="brand-logo">
            <button className="card thumb" onClick={() => onLogo(src)} title="Add this logo" aria-label={`Add logo ${i + 1}`}>
              <img src={src} alt="" />
            </button>
            <button className="brand-remove" onClick={() => setBrand({ ...brand, logos: brand.logos.filter((_, j) => j !== i) })} aria-label={`Remove logo ${i + 1}`} title="Remove">
              ×
            </button>
          </span>
        ))}
      </div>
      <button className="block" onClick={() => input.current?.click()}>
        Upload a logo
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label="Brand logo"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setBrand({ ...brand, logos: [...brand.logos, await shrink(await readFileAsDataURL(f))].slice(-8) });
        }}
      />
    </div>
  );
}
