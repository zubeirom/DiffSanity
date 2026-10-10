// Generates the extension icons as PNGs without external dependencies.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

// Shapes in a 128×128 design space: [x, y, width, height, radius, rgba].
const BACKGROUND = [0, 0, 128, 128, 26, [36, 41, 47, 255]];
const SHAPES = [
  // Code lines
  [18, 22, 52, 9, 4, [139, 148, 158, 255]],
  [18, 40, 64, 9, 4, [248, 81, 73, 255]],
  [18, 58, 58, 9, 4, [63, 185, 80, 255]],
  [18, 76, 44, 9, 4, [63, 185, 80, 255]],
  [18, 94, 56, 9, 4, [139, 148, 158, 255]],
  // Minimap strip with viewport indicator
  [94, 16, 18, 96, 5, [22, 27, 34, 255]],
  [94, 34, 18, 46, 5, [68, 147, 248, 110]],
  [98, 42, 10, 6, 2, [248, 81, 73, 255]],
  [98, 54, 10, 14, 2, [63, 185, 80, 255]],
];

function insideRoundedRect(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function blend(under, [r, g, b, a]) {
  const alpha = a / 255;
  const outA = alpha + under[3] * (1 - alpha);
  if (outA === 0) return [0, 0, 0, 0];
  const mix = (top, bottom) => (top * alpha + bottom * under[3] * (1 - alpha)) / outA;
  return [mix(r, under[0]), mix(g, under[1]), mix(b, under[2]), outA];
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 128 / size / SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = (x * SUPERSAMPLE + sx + 0.5) * step;
          const py = (y * SUPERSAMPLE + sy + 0.5) * step;
          let color = [0, 0, 0, 0];
          if (insideRoundedRect(px, py, BACKGROUND)) {
            color = blend(color, BACKGROUND[5]);
            for (const shape of SHAPES) if (insideRoundedRect(px, py, shape)) color = blend(color, shape[5]);
          }
          // Accumulate premultiplied colour so edges don't darken.
          sum[0] += color[0] * color[3];
          sum[1] += color[1] * color[3];
          sum[2] += color[2] * color[3];
          sum[3] += color[3];
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (y * size + x) * 4;
      const alpha = sum[3] / samples;
      pixels[offset] = alpha ? Math.round(sum[0] / sum[3]) : 0;
      pixels[offset + 1] = alpha ? Math.round(sum[1] / sum[3]) : 0;
      pixels[offset + 2] = alpha ? Math.round(sum[2] / sum[3]) : 0;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir('icons', { recursive: true });
for (const size of SIZES) {
  await writeFile(`icons/icon-${size}.png`, encodePng(size, render(size)));
}
console.log(`Wrote ${SIZES.map((size) => `icons/icon-${size}.png`).join(', ')}`);
