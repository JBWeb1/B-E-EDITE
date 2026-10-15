import type { Filters } from '../lib/filters';
import { RangeField } from './fields';

/** Sliders for brightness, contrast, saturation, blur and black & white. */
export function FilterSliders({ filters, mark, onChange }: { filters: Filters; mark: () => void; onChange: (patch: Partial<Filters>) => void }) {
  return (
    <>
      <RangeField label="Brightness" value={filters.brightness} min={0.2} max={2} step={0.01} onStart={mark} onChange={(v) => onChange({ brightness: v })} />
      <RangeField label="Contrast" value={filters.contrast} min={0.2} max={2} step={0.01} onStart={mark} onChange={(v) => onChange({ contrast: v })} />
      <RangeField label="Saturation" value={filters.saturation} min={0} max={3} step={0.01} onStart={mark} onChange={(v) => onChange({ saturation: v })} />
      <RangeField label="Blur" value={filters.blur} min={0} max={10} step={0.1} onStart={mark} onChange={(v) => onChange({ blur: v })} />
      <RangeField label="Black & white" value={filters.grayscale} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => onChange({ grayscale: v })} />
    </>
  );
}
