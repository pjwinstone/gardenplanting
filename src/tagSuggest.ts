/** Auto-suggest large bright / white printed-tag blobs in a photo (not tiny tin). */

export type TagSuggestion = {
  px: number;
  py: number;
  /** Approx blob area in photo pixels². */
  area: number;
  /** Width/height of blob bbox in photo pixels. */
  w: number;
  h: number;
};

const MAX_WORK_EDGE = 320;
const MAX_SUGGESTIONS = 6;

/**
 * Find bright, sizable blobs suitable as printed white tags.
 * Coordinates are in the photo’s native pixel space (naturalWidth × naturalHeight).
 */
export async function suggestTagBlobs(
  dataUrl: string,
  photoWidth: number,
  photoHeight: number,
): Promise<TagSuggestion[]> {
  const img = await loadImage(dataUrl);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) return [];

  const scale = Math.min(1, MAX_WORK_EDGE / Math.max(nw, nh));
  const sw = Math.max(1, Math.round(nw * scale));
  const sh = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  const lum = new Float32Array(sw * sh);
  let sum = 0;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const y = 0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
    lum[i] = y;
    sum += y;
  }
  const mean = sum / lum.length;
  // Bright relative to scene — printed white tags; avoid needing pure #fff.
  const threshold = Math.min(245, Math.max(mean + 40, mean * 1.35));

  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    mask[i] = lum[i]! >= threshold ? 1 : 0;
  }

  const visited = new Uint8Array(lum.length);
  const comps: Array<{ cx: number; cy: number; area: number; w: number; h: number }> = [];
  const minArea = Math.max(40, (sw * sh) * 0.0012); // reject tiny tin-like flecks
  const maxArea = (sw * sh) * 0.22;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i0 = y * sw + x;
      if (!mask[i0] || visited[i0]) continue;
      // Flood fill
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      let sx = 0;
      let sy = 0;
      const stack = [i0];
      visited[i0] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const px = i % sw;
        const py = (i / sw) | 0;
        area += 1;
        sx += px;
        sy += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const nbors = [i - 1, i + 1, i - sw, i + sw];
        for (const n of nbors) {
          if (n < 0 || n >= lum.length) continue;
          if (!mask[n] || visited[n]) continue;
          // keep 4-neighbour within row for L/R
          if ((n === i - 1 || n === i + 1) && ((n / sw) | 0) !== py) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }
      if (area < minArea || area > maxArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const aspect = bw / Math.max(1, bh);
      // Elongated OK; reject hairline scraps (very thin in both dims already filtered by area).
      if (aspect < 0.2 || aspect > 6) continue;
      comps.push({
        cx: sx / area,
        cy: sy / area,
        area,
        w: bw,
        h: bh,
      });
    }
  }

  comps.sort((a, b) => b.area - a.area);
  const top = comps.slice(0, MAX_SUGGESTIONS);

  // Map work-canvas coords → photo record pixel space.
  const outW = photoWidth > 0 ? photoWidth : nw;
  const outH = photoHeight > 0 ? photoHeight : nh;
  const sx = outW / sw;
  const sy = outH / sh;
  return top.map((c) => ({
    px: c.cx * sx,
    py: c.cy * sy,
    area: c.area * sx * sy,
    w: c.w * sx,
    h: c.h * sy,
  }));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load photo for tag suggest.'));
    img.src = src;
  });
}

/** Read natural pixel size of a data-URL image. */
export async function imageNaturalSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return {
    width: img.naturalWidth || img.width || 1200,
    height: img.naturalHeight || img.height || 900,
  };
}
