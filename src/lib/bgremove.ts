/**
 * Remove a plain background (white studio shots, green screens, flat colors)
 * by flood-filling from the picture's edges. Pixels connected to the border
 * whose color is close to the border's typical color become transparent, and
 * the edge of the subject is softened so it doesn't look cut out with scissors.
 *
 * `tolerance` is 0..100 (% of the largest possible color difference).
 * Works in place on RGBA data and returns how many pixels were removed.
 */
export function removePlainBackground(data: Uint8ClampedArray, width: number, height: number, tolerance: number): number {
  const n = width * height;
  if (n === 0) return 0;
  const ref = borderColor(data, width, height);
  const limit = (Math.max(0, Math.min(100, tolerance)) / 100) * 441.68; // 441.68 = distance black→white
  const dist = (i: number) => {
    const dr = data[i * 4] - ref[0];
    const dg = data[i * 4 + 1] - ref[1];
    const db = data[i * 4 + 2] - ref[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const background = new Uint8Array(n);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!background[i] && dist(i) <= limit) {
      background[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < n - width) visit(i + width);
  }

  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (background[i]) {
      data[i * 4 + 3] = 0;
      removed++;
      continue;
    }
    // Soften subject pixels that touch the background, by how close they are to it.
    const x = i % width;
    const touches =
      (x > 0 && background[i - 1]) ||
      (x < width - 1 && background[i + 1]) ||
      (i >= width && background[i - width]) ||
      (i < n - width && background[i + width]);
    if (touches && limit > 0) {
      const t = Math.max(0, Math.min(1, (dist(i) - limit) / limit));
      data[i * 4 + 3] = Math.round(data[i * 4 + 3] * (0.35 + 0.65 * t));
    }
  }
  return removed;
}

/** Median color of the outermost pixels: a robust guess of the background color. */
export function borderColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const add = (i: number) => {
    rs.push(data[i * 4]);
    gs.push(data[i * 4 + 1]);
    bs.push(data[i * 4 + 2]);
  };
  for (let x = 0; x < width; x++) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    add(y * width);
    add(y * width + width - 1);
  }
  const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  return [median(rs), median(gs), median(bs)];
}

/** Load an image, remove its plain background and return a PNG data URL plus its size. */
export async function removeBackgroundFromImage(
  src: string,
  tolerance: number,
  maxSide = 2048,
): Promise<{ src: string; width: number; height: number; removed: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const removed = removePlainBackground(pixels.data, canvas.width, canvas.height, tolerance);
  ctx.putImageData(pixels, 0, 0);
  return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, removed };
}
