/**
 * Entry point: wires content enhancements, the scroll controller and the
 * render loop. All essential content is plain HTML; everything here is
 * progressive enhancement.
 */

import { ScrollController } from './scroll-controller.js';
import { initNavigation } from './navigation.js';
import { buildConstellations } from './skills-constellation.js';
import { clamp } from './gl-math.js';

const TIERS = {
  high: { dpr: 2, stars: 2600, dust: 1400, lon: 128, lat: 80, textureSize: 4096 },
  medium: { dpr: 1.6, stars: 1700, dust: 800, lon: 72, lat: 48, textureSize: 2048 },
  low: { dpr: 1.15, stars: 1000, dust: 400, lon: 56, lat: 40, textureSize: 1024 },
};

function detectQuality() {
  const mobile = window.innerWidth < 760 || window.matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const saveData = navigator.connection?.saveData;
  let tier = mobile ? 'medium' : 'high';
  if (saveData || mem <= 2 || cores <= 2 || (mobile && (mem <= 4 || cores <= 4))) tier = 'low';
  return { tier, ...TIERS[tier] };
}

/* ---------- Static content enhancements ---------- */

function setupResumeLinks() {
  const pdf = document.querySelector('meta[name="resume-pdf"]')?.content.trim();
  document.querySelectorAll('[data-resume-link]').forEach((a) => {
    if (pdf) {
      a.href = pdf;
      a.setAttribute('download', '');
    } else {
      // No PDF published yet: offer a résumé request by email instead of a dead link.
      a.href = 'mailto:saurabhsawant077@gmail.com?subject=R%C3%A9sum%C3%A9%20request';
      a.removeAttribute('download');
      const label = a.querySelector('[data-resume-label]');
      if (label) label.textContent = 'Request Résumé';
    }
  });
}

function setupReveals() {
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.target.classList.toggle('is-visible', e.isIntersecting)),
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );
  els.forEach((el) => io.observe(el));
}

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
setupResumeLinks();
buildConstellations();
setupReveals();
const nav = initNavigation();

/* ---------- Scroll journey ---------- */

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.querySelector('.stage');
const layer = document.querySelector('[data-stage-layer]');
const hero = document.getElementById('home');
const experience = document.getElementById('experience');
const hud = {
  index: document.querySelector('[data-hud-index]'),
  label: document.querySelector('[data-hud-label]'),
  readout: document.querySelector('[data-hud-readout]'),
  bar: document.querySelector('[data-hud-bar]'),
};

const controller = new ScrollController([...document.querySelectorAll('main > [data-scene]')]);
// ?debug disables camera smoothing (handy for screenshots / automated checks).
controller.damping = !new URLSearchParams(location.search).has('debug');

let scene = null;
let quality = detectQuality();
let time = 0;
let last = performance.now();
let rafId = 0;
let shownName = null;
let fadeTimer = 0;
let lastHud = { index: -1, readoutAt: 0, dim: -1 };
const perf = { frames: 0, total: 0, checks: 0, startAt: performance.now() + 2500 };

const sceneCanvas = document.getElementById('scene-canvas');
const labelCanvas = document.getElementById('label-canvas');
const fallbackCanvas = document.getElementById('fallback-canvas');
const fallbackEarth = document.getElementById('scene-fallback');
let glScene = null;

async function createScene() {
  try {
    const { SpaceScene } = await import('./space-scene.js');
    glScene = new SpaceScene(sceneCanvas, labelCanvas, quality, {
      onContextLost: () => useFallback(),
      onContextRestored: () => {
        fallbackCanvas.hidden = true;
        fallbackEarth.hidden = true;
        sceneCanvas.hidden = false;
        labelCanvas.hidden = false;
        stage.classList.remove('is-fallback');
        glScene.resize();
        scene = glScene;
      },
    });
    scene = glScene;
    stage.classList.add('is-ready');
  } catch (err) {
    console.warn('WebGL scene unavailable, using 2D fallback:', err.message);
    await useFallback();
  }
}

async function useFallback() {
  const { FallbackScene } = await import('./fallback-scene.js');
  sceneCanvas.hidden = true;
  labelCanvas.hidden = true;
  fallbackCanvas.hidden = false;
  scene = new FallbackScene(fallbackCanvas, fallbackEarth, quality);
  stage.classList.add('is-ready', 'is-fallback');
}

function updateHud(state) {
  const active = controller.activeSection();
  if (active.index !== lastHud.index) {
    lastHud.index = active.index;
    hud.index.textContent = String(active.index + 1).padStart(2, '0');
    hud.label.textContent = active.label;
  }
  const now = performance.now();
  if (now - lastHud.readoutAt > 140) {
    lastHud.readoutAt = now;
    let range = state.dist;
    if (scene === glScene && glScene?.eye) {
      const e = glScene.eye;
      range = Math.hypot(e[0] - 30, e[1], e[2]);
    }
    const km = Math.max(0, (range - 1) * 6371);
    hud.readout.textContent = `${Math.round(km).toLocaleString('en-US')} km`;
  }
  hud.bar.style.transform = `scaleY(${state.progress.toFixed(4)})`;
}

function monitorPerformance(dt) {
  if (!scene?.setResolutionScale || controller.reducedMotion) return;
  if (dt > 0.2) return; // throttled frames (background/occluded) say nothing about GPU load
  const now = performance.now();
  if (now < perf.startAt || perf.checks >= 3) return;
  perf.frames++;
  perf.total += dt;
  if (perf.frames >= 90) {
    const avg = perf.total / perf.frames;
    if (avg > 1 / 42 && quality.dpr > 1) {
      quality.dpr = Math.max(1, quality.dpr - 0.35);
      scene.setResolutionScale(quality.dpr);
    }
    perf.checks++;
    perf.frames = 0;
    perf.total = 0;
    perf.startAt = now + 1500;
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.1, rawDt);
  last = now;
  const reduced = controller.reducedMotion;
  if (!reduced) time += dt;

  const y = window.scrollY;
  controller.setTarget(y);
  controller.update(dt);
  const state = controller.state(time);

  nav.update(y);
  hero.style.setProperty('--hero-progress', clamp(y / (controller.vh * 0.75)).toFixed(3));
  experience.style.setProperty('--exp-progress', controller.sectionProgress('experience', 0.55).toFixed(3));
  updateHud(state);

  if (Math.abs(state.dim - lastHud.dim) > 0.004) {
    lastHud.dim = state.dim;
    layer.style.setProperty('--scene-dim', state.dim.toFixed(3));
  }

  if (!scene) return;
  if (reduced) {
    // Static states with a short cross-fade instead of camera moves.
    if (state.name !== shownName && !fadeTimer) {
      const first = shownName === null;
      stage.classList.add('is-fading');
      fadeTimer = setTimeout(() => {
        shownName = state.name;
        scene.render(controller.state(time), time);
        stage.classList.remove('is-fading');
        fadeTimer = 0;
      }, first ? 0 : 280);
    }
    return;
  }
  shownName = state.name;
  scene.render(state, time);
  monitorPerformance(rawDt);
}

function start() {
  if (rafId) return;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}
function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

let resizeTimer = 0;
function remeasure() {
  controller.measure();
  scene?.resize();
  shownName = null; // force a redraw in reduced-motion mode
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(remeasure, 120);
});
new ResizeObserver(() => controller.measure()).observe(document.querySelector('main'));
document.fonts?.ready.then(() => controller.measure());

function applyMotionPreference(reduced) {
  controller.reducedMotion = reduced;
  shownName = null;
  // SMIL orbit animations in inline SVGs aren't covered by the CSS media query.
  document.querySelectorAll('svg').forEach((svg) => {
    if (reduced) svg.pauseAnimations?.(); else svg.unpauseAnimations?.();
  });
}
applyMotionPreference(motionQuery.matches);
motionQuery.addEventListener('change', (e) => applyMotionPreference(e.matches));

start();
// Build the WebGL scene after first paint so text renders immediately.
requestAnimationFrame(() => setTimeout(createScene, 0));
