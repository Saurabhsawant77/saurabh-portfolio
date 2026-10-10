/**
 * Turns each skill group's plain HTML list into a small star chart.
 * The list stays the accessible source of truth; the SVG is decorative.
 * Stars for skills marked data-core (used in the experience/projects on this
 * page) are drawn brighter. Hovering a list item lights up its star.
 */

import { seededRandom } from './gl-math.js';

const W = 320;
const H = 150;
const PAD = 18;
const SVG_NS = 'http://www.w3.org/2000/svg';

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function placeStars(count, rand) {
  const pts = [];
  const minDist = Math.max(30, 64 - count * 3.2);
  for (let i = 0; i < count; i++) {
    let best = null;
    let bestScore = -1;
    for (let tries = 0; tries < 40; tries++) {
      const p = { x: PAD + rand() * (W - PAD * 2), y: PAD + rand() * (H - PAD * 2) };
      const d = pts.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);
      if (d >= minDist) { best = p; break; }
      if (d > bestScore) { bestScore = d; best = p; }
    }
    pts.push(best);
  }
  return pts;
}

/** Nearest-neighbour chain from the left-most star, plus a closing link. */
function connect(pts) {
  const order = [];
  const left = new Set(pts.map((_, i) => i));
  let cur = pts.reduce((m, p, i) => (p.x < pts[m].x ? i : m), 0);
  while (left.size) {
    order.push(cur);
    left.delete(cur);
    let next = -1;
    let nd = Infinity;
    for (const j of left) {
      const d = Math.hypot(pts[j].x - pts[cur].x, pts[j].y - pts[cur].y);
      if (d < nd) { nd = d; next = j; }
    }
    if (next < 0) break;
    cur = next;
  }
  const edges = [];
  for (let i = 1; i < order.length; i++) edges.push([order[i - 1], order[i]]);
  if (order.length > 4) edges.push([order[1], order[order.length - 2]]);
  return edges;
}

export function buildConstellations(root = document) {
  root.querySelectorAll('[data-constellation]').forEach((group) => {
    const host = group.querySelector('.constellation__chart');
    const items = [...group.querySelectorAll('.skill-list li')];
    if (!host || !items.length) return;

    const rand = seededRandom(hashString(group.id || group.textContent));
    const pts = placeStars(items.length, rand);
    const edges = connect(pts);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    edges.forEach(([a, b], i) => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', pts[a].x.toFixed(1));
      line.setAttribute('y1', pts[a].y.toFixed(1));
      line.setAttribute('x2', pts[b].x.toFixed(1));
      line.setAttribute('y2', pts[b].y.toFixed(1));
      line.setAttribute('pathLength', '1');
      line.style.setProperty('--i', i);
      svg.appendChild(line);
    });

    const stars = items.map((li, i) => {
      const core = li.hasAttribute('data-core');
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', core ? 'star star--core' : 'star');
      g.style.setProperty('--i', i);
      const halo = document.createElementNS(SVG_NS, 'circle');
      halo.setAttribute('class', 'star__halo');
      halo.setAttribute('cx', pts[i].x.toFixed(1));
      halo.setAttribute('cy', pts[i].y.toFixed(1));
      halo.setAttribute('r', core ? 9 : 7);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'star__dot');
      dot.setAttribute('cx', pts[i].x.toFixed(1));
      dot.setAttribute('cy', pts[i].y.toFixed(1));
      dot.setAttribute('r', core ? 3.1 : 1.9);
      g.append(halo, dot);
      svg.appendChild(g);
      return g;
    });

    host.appendChild(svg);

    items.forEach((li, i) => {
      const on = () => stars[i].classList.add('is-active');
      const off = () => stars[i].classList.remove('is-active');
      li.addEventListener('pointerenter', on);
      li.addEventListener('pointerleave', off);
    });
  });
}
