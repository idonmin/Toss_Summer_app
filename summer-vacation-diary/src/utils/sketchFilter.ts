import { ImageProcessError, loadImageFromDataUrl } from "./image";

// ---------------------------------------------------------------------------
// Local "colored pencil" filter — the stand-in provider for stage 3 when no
// API key is configured (체험 모드). Pure canvas pixel work, no network:
//  1. posterize      — flatten colors into a few levels, like crayon fills
//  2. edge darkening — Sobel edges become pencil outlines
//  3. paper grain    — deterministic noise so flat areas look hand-shaded
//  4. warm tint      — pull everything toward cream diary paper
// It won't fool anyone next to a real image model, but it exercises the exact
// same UI states (loading / success / toggle / error), so the whole stage-3
// flow can be developed and demoed without spending API credits.
// ---------------------------------------------------------------------------

// 1024px keeps the pixel loop around ~1M iterations (fast even on low-end
// phones) while still looking sharp inside the 480px-wide diary card.
const FILTER_MAX_DIMENSION_PX = 1024;
const POSTERIZE_LEVELS = 6;
// 0..1: how hard detected edges darken toward a pencil line.
const EDGE_STRENGTH = 0.85;
// ± range of the per-pixel grain, in 0-255 channel units.
const GRAIN_AMPLITUDE = 9;

export async function applyPencilFilter(dataUrl: string): Promise<string> {
  const image = await loadImageFromDataUrl(dataUrl);

  const scale = Math.min(
    1,
    FILTER_MAX_DIMENSION_PX / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ImageProcessError("load-failed");
  }
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Luminance is precomputed once so the Sobel pass below reads neighbors
  // from a flat array instead of recomputing RGB → luma 8 times per pixel.
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] =
      0.299 * pixels[i * 4] +
      0.587 * pixels[i * 4 + 1] +
      0.114 * pixels[i * 4 + 2];
  }

  const step = 255 / (POSTERIZE_LEVELS - 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;

      // Sobel gradient; border pixels clamp to themselves instead of
      // wrapping, which would draw a false outline along the image edge.
      const xm = x > 0 ? x - 1 : x;
      const xp = x < width - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y;
      const yp = y < height - 1 ? y + 1 : y;
      const topLeft = luma[ym * width + xm];
      const top = luma[ym * width + x];
      const topRight = luma[ym * width + xp];
      const left = luma[y * width + xm];
      const right = luma[y * width + xp];
      const bottomLeft = luma[yp * width + xm];
      const bottom = luma[yp * width + x];
      const bottomRight = luma[yp * width + xp];
      const gx = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const magnitude = Math.min(1, Math.hypot(gx, gy) / 255);
      const edge = 1 - magnitude * EDGE_STRENGTH;

      // Integer-hash grain instead of Math.random(): the same photo always
      // produces the same "drawing", so re-renders never flicker.
      const noise =
        (((i * 2654435761) >>> 16) % (GRAIN_AMPLITUDE * 2 + 1)) -
        GRAIN_AMPLITUDE;

      const p = i * 4;
      for (let channel = 0; channel < 3; channel++) {
        const posterized = Math.round(pixels[p + channel] / step) * step;
        let value = posterized * edge + noise;
        // Warm paper tint: lift red the most, blue the least, so whites turn
        // cream and shadows go brown-ish like pencil on diary paper.
        if (channel === 0) {
          value = value * 0.96 + 16;
        } else if (channel === 1) {
          value = value * 0.94 + 12;
        } else {
          value = value * 0.9 + 8;
        }
        pixels[p + channel] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}
