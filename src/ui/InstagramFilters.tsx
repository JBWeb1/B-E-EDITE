import { cssFilter, INSTAGRAM_FILTERS, sameFilters } from '../lib/filters';
import type { Filters } from '../lib/filters';

/** A sunset-like sample, so a filter's tone shows even with no picture to preview. */
const SAMPLE = 'linear-gradient(160deg, #3b82f6 0%, #f472b6 45%, #fbbf24 70%, #16a34a 100%)';

/**
 * The Instagram-style filters as a grid of small previews. `thumb` is a picture to
 * preview them on (a frame of the clip or the photo); without one a colourful sample is used.
 */
export function InstagramFilterGrid({
  current,
  thumb,
  disabled,
  onPick,
}: {
  current: Filters | undefined;
  thumb?: string | null;
  disabled?: boolean;
  onPick: (f: Filters) => void;
}) {
  return (
    <div className="ig-grid" role="group" aria-label="Instagram filters">
      {INSTAGRAM_FILTERS.map((p) => (
        <button
          key={p.label}
          className={`ig-card ${current && sameFilters(current, p.filters) ? 'active' : ''}`}
          onClick={() => onPick(p.filters)}
          disabled={disabled}
          aria-label={`Instagram filter: ${p.label}`}
          title={p.label}
        >
          <span className="ig-thumb" style={{ backgroundImage: thumb ? `url(${thumb})` : SAMPLE, filter: cssFilter(p.filters) }} />
          <span className="ig-label">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
