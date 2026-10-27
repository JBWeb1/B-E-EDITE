export interface PdfPage {
  /** JPEG file bytes. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** Page size in points (1/72 inch). */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Build a minimal PDF where each page is one full-page JPEG image.
 * JPEGs can be embedded as-is (DCTDecode), so no PDF library is needed.
 */
export function makePdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  // A comment with high bytes tells tools the file is binary.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pageId = pageIds[i];
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const w = p.pageWidth.toFixed(2);
    const h = p.pageHeight.toFixed(2);
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    object(imageId, [
      enc.encode(
        `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      ),
      p.jpeg,
      enc.encode('\nendstream'),
    ]);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const count = offsets.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
