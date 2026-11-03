// The site's icons: stroke SVG on a 24-unit grid, drawn in currentColor so
// each takes its colour from the text around it. Kept as data so the set is
// visible in one place and adds no dependency or icon font.

const SHAPES = {
  swim: [
    ['path', { d: 'M2 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2' }],
    ['path', { d: 'M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2' }],
    ['circle', { cx: 16, cy: 7, r: 2 }],
    ['path', { d: 'M6 12l4-4 4 2' }]
  ],
  bike: [
    ['circle', { cx: 6, cy: 16, r: 3.5 }],
    ['circle', { cx: 18, cy: 16, r: 3.5 }],
    ['path', { d: 'M6 16l4-8h5l3 8' }],
    ['path', { d: 'M8 8h3' }],
    ['path', { d: 'M12 16l-2-8' }]
  ],
  run: [
    ['circle', { cx: 14, cy: 4.5, r: 2 }],
    ['path', { d: 'M8 21l3-6 3 2v5' }],
    ['path', { d: 'M6 12l3-3 4 1 3 4h3' }],
    ['path', { d: 'M11 15l-1-5' }]
  ],
  strength: [
    ['path', { d: 'M3 10v4' }],
    ['path', { d: 'M6 7v10' }],
    ['path', { d: 'M18 7v10' }],
    ['path', { d: 'M21 10v4' }],
    ['path', { d: 'M6 12h12' }]
  ],
  moon: [['path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }]],
  alarm: [
    ['circle', { cx: 12, cy: 13, r: 7 }],
    ['path', { d: 'M12 10v3l2 2' }],
    ['path', { d: 'M5 4L2 7M19 4l3 3' }]
  ],
  bag: [
    ['path', { d: 'M6 8h12l-1 12H7L6 8z' }],
    ['path', { d: 'M9 8V6a3 3 0 0 1 6 0v2' }]
  ],
  food: [
    ['path', { d: 'M7 3v8a2 2 0 0 0 4 0V3M9 11v10' }],
    ['path', { d: 'M17 21V3c-2 1-3 3.5-3 6s1 4 3 4' }]
  ],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]
  ],
  week: [
    ['rect', { x: 3, y: 5, width: 18, height: 16, rx: 3 }],
    ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]
  ],
  month: [
    ['rect', { x: 3, y: 4, width: 18, height: 17, rx: 3 }],
    ['path', { d: 'M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01' }]
  ],
  season: [['path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }]],
  left: [['path', { d: 'M15 6l-6 6 6 6' }]],
  right: [['path', { d: 'M9 6l6 6-6 6' }]],
  check: [['path', { d: 'M5 12l5 5 9-10' }]],
  cross: [['path', { d: 'M7 7l10 10M17 7L7 17' }]],
  half: [['path', { d: 'M5 12h14' }]],
  warn: [
    ['path', { d: 'M12 3l10 18H2L12 3z' }],
    ['path', { d: 'M12 10v4M12 17.5h.01' }]
  ],
  home: [['path', { d: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z' }]]
};

export const ICON_NAMES = Object.keys(SHAPES);

const NS = 'http://www.w3.org/2000/svg';

// An icon as an <svg> element. Decorative unless given a label, because the
// text beside it almost always says the same thing.
export function icon(name, { size = 20, stroke = 2, label = null, cls = null } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  const attrs = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': stroke,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  if (cls) svg.setAttribute('class', cls);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, a] of SHAPES[name] || []) {
    const child = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}
