import { describe, expect, it } from 'vitest';
import { makePdf } from './pdf';

describe('makePdf', () => {
  it('writes a valid cross-reference table pointing at every object', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const blob = makePdf([
      { jpeg, width: 2, height: 1, pageWidth: 100, pageHeight: 50 },
      { jpeg, width: 2, height: 1, pageWidth: 100, pageHeight: 50 },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');

    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(8); // catalog, pages, and 3 objects per page
    entries.forEach((offset, i) => expect(text.slice(offset, offset + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
