// One integer pixel grid drives both the web logo and multi-resolution Windows icon.
import { mkdir, writeFile } from 'node:fs/promises';
const rows = [
  '................', '...PPPPPPPPPP...', '..PPPPPPPPPPPP..', '.PPPPPPPPPPPPPP.',
  '.PPCCCCCCCCCCPP.', '.PPCCCCCCCCCCPP.', '.PPCCDDCCDDCCPP.', '.PPCCDDCCDDCCPP.',
  '.PPCCCCCCCCCCPP.', '.PPCCCCMMCCCCPP.', '.PPCCCCCCCCCCPP.', '..PPPPCCPPPPPP..',
  '...PPPCCPPPPP...', '.....PPP........', '.....PP.........', '................'
];
const colors = { P: '#a78bfa', C: '#f4f0ff', D: '#191525', M: '#65e0bc' };
const root = new URL('../assets/', import.meta.url);
await mkdir(root, { recursive: true });
const rects = rows.flatMap((row, y) => [...row].flatMap((pixel, x) =>
  colors[pixel] ? [`<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[pixel]}"/>`] : []));
await writeFile(new URL('chatiffy.svg', root), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>\n`);
const sizes = [16, 32, 48, 64, 256];
const frames = sizes.map(size => {
  const maskStride = Math.ceil(size / 32) * 4;
  const frame = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  frame.writeUInt32LE(40, 0); frame.writeInt32LE(size, 4); frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12); frame.writeUInt16LE(32, 14); frame.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = colors[rows[Math.floor(y * 16 / size)][Math.floor(x * 16 / size)]];
    const offset = 40 + ((size - 1 - y) * size + x) * 4;
    if (color) {
      const rgb = parseInt(color.slice(1), 16);
      frame[offset] = rgb & 255; frame[offset + 1] = (rgb >> 8) & 255;
      frame[offset + 2] = rgb >> 16; frame[offset + 3] = 255;
    } else frame[40 + size * size * 4 + (size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x % 8);
  }
  return frame;
});
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const pos = 6 + i * 16;
  header[pos] = header[pos + 1] = size % 256;
  header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(frames[i].length, pos + 8); header.writeUInt32LE(offset, pos + 12);
  offset += frames[i].length;
});
await writeFile(new URL('chatiffy.ico', root), Buffer.concat([header, ...frames]));
