import type { Paint } from '../shared/contracts.js';

export function rgba7tv(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return '';
    return `rgba(${(value >>> 24) & 255}, ${(value >>> 16) & 255}, ${(value >>> 8) & 255}, ${((value & 255) / 255).toFixed(3)})`;
  }

export function paint7tvAuthor(author: HTMLElement, paint: Paint | null, fallbackColor: string) {
    author.classList.remove('author-painted');
    author.style.backgroundImage = '';
    author.style.backgroundClip = '';
    author.style.webkitBackgroundClip = '';
    author.style.webkitTextFillColor = '';
    author.style.filter = '';
    if (!paint) {
      if (fallbackColor) author.style.color = fallbackColor;
      return;
    }
    author.classList.add('author-painted');
    const kind = String(paint.function || '').toUpperCase().replaceAll('-', '_');
    const stops = Array.isArray(paint.stops)
      ? paint.stops.filter((stop) => Number.isFinite(stop.at) && Number.isInteger(stop.color))
        .map((stop) => `${rgba7tv(stop.color)} ${stop.at * 100}%`)
      : [];
    let background = '';
    if ((kind === 'LINEAR_GRADIENT' || kind === 'RADIAL_GRADIENT') && stops.length) {
      const repeat = paint.repeat ? 'repeating-' : '';
      const prefix = kind === 'LINEAR_GRADIENT' ? `${Number(paint.angle) || 0}deg, ` : `${paint.shape === 'ellipse' ? 'ellipse' : 'circle'}, `;
      background = `${repeat}${kind === 'LINEAR_GRADIENT' ? 'linear' : 'radial'}-gradient(${prefix}${stops.join(', ')})`;
    } else if (kind === 'URL' && /^https:\/\/cdn\.7tv\.app\//.test(paint.image_url || '')) {
      background = `url("${paint.image_url}")`;
    }
    const solid = rgba7tv(paint.color) || fallbackColor;
    if (background) {
      author.style.backgroundImage = background;
      author.style.backgroundPosition = 'center';
      author.style.backgroundSize = '100% 100%';
      author.style.backgroundClip = 'text';
      author.style.webkitBackgroundClip = 'text';
      author.style.color = 'transparent';
      author.style.webkitTextFillColor = 'transparent';
    } else if (solid) {
      author.style.color = solid;
    }
    const shadows = Array.isArray(paint.shadows) ? paint.shadows.slice(0, 8) : [];
    const filters = shadows.map((shadow) => {
      const x = Math.max(-20, Math.min(20, Number(shadow.x_offset) || 0));
      const y = Math.max(-20, Math.min(20, Number(shadow.y_offset) || 0));
      const radius = Math.max(0, Math.min(20, Number(shadow.radius) || 0));
      const color = rgba7tv(shadow.color);
      return color ? `drop-shadow(${x}px ${y}px ${radius}px ${color})` : '';
    }).filter(Boolean);
    if (filters.length) author.style.filter = filters.join(' ');
  }

