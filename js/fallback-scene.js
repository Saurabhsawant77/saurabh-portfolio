/**
 * FallbackScene — used when WebGL is unavailable or the context is lost.
 * A static Canvas 2D starfield plus a CSS-shaded Earth that follows the same
 * scroll-driven camera state (scale + offset), so the journey still reads.
 */

import { LAND, WATER } from './earth-data.js';
import { seededRandom, clamp } from './gl-math.js';

function earthTexture(width = 1024, height = 512) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, height);
  sea.addColorStop(0, '#0d2f5c');
  sea.addColorStop(0.5, '#0a3b73');
  sea.addColorStop(1, '#0d2f5c');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, width, height);
  const draw = (polys, fill) => {
    ctx.fillStyle = fill;
    for (const poly of polys) {
      ctx.beginPath();
      poly.forEach(([lon, lat], i) => {
        const x = ((lon + 180) / 360) * width;
        const y = ((90 - lat) / 180) * height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
  };
  draw(LAND, '#3c5a34');
  draw(WATER, '#0a3b73');
  ctx.fillStyle = 'rgba(235,242,255,0.9)';
  ctx.fillRect(0, height * 0.94, width, height * 0.06);
  return c.toDataURL('image/jpeg', 0.85);
}

export class FallbackScene {
  constructor(canvas, earthEl, quality) {
    this.canvas = canvas;
    this.earthEl = earthEl;
    this.ctx = canvas.getContext('2d');
    this.starCount = Math.round(quality.stars * 0.35);
    earthEl.hidden = false;
    earthEl.style.setProperty('--earth-map', `url(${earthTexture()})`);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w;
    this.h = h;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#02050d';
    ctx.fillRect(0, 0, w, h);
    const rand = seededRandom(7);
    for (let i = 0; i < this.starCount; i++) {
      const r = rand();
      ctx.globalAlpha = 0.25 + rand() * 0.7;
      ctx.fillStyle = r > 0.9 ? '#ffe2c4' : r > 0.7 ? '#cfe0ff' : '#ffffff';
      const s = r > 0.96 ? 1.8 : r > 0.8 ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  render(state) {
    const scale = clamp(2.7 / state.dist, 0.015, 1);
    const x = (state.shiftX * this.w) / 2;
    const y = (-state.shiftY * this.h) / 2;
    const el = this.earthEl;
    el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(4)})`;
    el.style.setProperty('--earth-spin', `${((state.spin * 50) % 200).toFixed(2)}%`);
    el.style.opacity = String(clamp(scale * 8, 0.35, 1));
  }
}
