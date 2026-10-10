/**
 * ScrollController — maps the document scroll position to a camera state.
 *
 * Every <section data-scene="name"> contributes two keyframes: one when the
 * section arrives (top near the viewport top) and one when it is about to
 * leave. Between a section's own keyframes the camera drifts gently (linear),
 * and between sections it travels with an ease-in-out curve. Because the state
 * is a pure function of the scroll position, scrolling up replays the journey
 * in reverse automatically.
 */

import { clamp, lerp, easeInOutCubic } from './gl-math.js';

const BASE = {
  focus: 0, dist: 3, az: 1, el: 0.1, shiftX: 0, shiftY: 0,
  orbits: 0, labels: 0, nearLabels: 0, moonOrbit: 0, marker: 0,
  trajectory: 0, dust: 1, dim: 1, satellites: 0,
};

/* Camera presets. az/el are radians around the focus point (az = 0 looks
   at Earth from the Sun's side). shiftX/Y move the composition on screen so
   celestial bodies sit beside, not under, the text. */
const PRESETS = {
  home: { dist: 3.05, az: 0.95, el: 0.1, shiftX: 0.44, marker: 1, satellites: 1 },
  profile: { dist: 8.5, az: 1.22, el: 0.24, shiftX: 0.3, shiftY: 0.02, nearLabels: 1, moonOrbit: 1, marker: 0.7, satellites: 1 },
  trajectory: { focus: 0.5, dist: 80, az: 1.5, el: 0.45, shiftX: 0.44, shiftY: -0.02, orbits: 1, labels: 1, moonOrbit: 0.25 },
  about: { focus: 0.8, dist: 104, az: 1.85, el: 0.5, shiftX: -0.34, orbits: 1, labels: 0.8, dim: 0.95 },
  experience: { focus: 0.92, dist: 82, az: 2.15, el: 0.34, shiftX: 0.52, orbits: 1, labels: 0.65, trajectory: 1, dim: 0.9 },
  experienceEnd: { focus: 0.95, dist: 98, az: 2.6, el: 0.42, shiftX: 0.52, orbits: 1, labels: 0.65, trajectory: 1, dim: 0.9 },
  skills: { focus: 1, dist: 205, az: 2.95, el: 1.05, orbits: 0.75, dim: 0.42 },
  projects: { focus: 1, dist: 140, az: 3.5, el: 0.2, orbits: 0.8, dim: 0.48 },
  education: { focus: 1, dist: 215, az: 4.0, el: 0.62, shiftX: -0.32, orbits: 1, labels: 0.5, dim: 0.75 },
  contact: { focus: 1, dist: 165, az: 4.5, el: 0.3, shiftY: -0.7, orbits: 1, labels: 0.6, dim: 1 },
};

/* Phone layouts stack text under the scene, so compositions move vertically. */
const MOBILE = {
  home: { dist: 3.95, shiftX: 0, shiftY: 0.47 },
  profile: { dist: 10, shiftX: 0, shiftY: 0.34 },
  trajectory: { shiftX: 0, shiftY: 0.3, dist: 95 },
  about: { shiftX: 0, shiftY: 0.28, dim: 0.55 },
  experience: { shiftX: 0, shiftY: 0.2, dim: 0.45 },
  experienceEnd: { shiftX: 0, shiftY: 0.2, dim: 0.45 },
  skills: { dim: 0.32 },
  projects: { dim: 0.35 },
  education: { shiftX: 0, dim: 0.45 },
  contact: { shiftY: -0.62, dist: 220 },
};

const SECTOR_NAMES = {
  home: 'Earth · Low orbit',
  profile: 'Earth–Moon system',
  trajectory: 'Mission log',
  about: 'Engineering systems',
  experience: 'Career trajectory',
  skills: 'Technology constellation',
  projects: 'Project missions',
  education: 'Mission archive',
  contact: 'Final destination',
};

const KEYS = Object.keys(BASE);

export class ScrollController {
  constructor(sections) {
    this.sections = sections;
    this.keys = [];
    this.current = window.scrollY;
    this.target = window.scrollY;
    this.layout = 'desktop';
    this.reducedMotion = false;
    this.measure();
  }

  preset(name) {
    const p = { ...BASE, ...PRESETS[name] };
    if (this.layout === 'mobile' && MOBILE[name]) Object.assign(p, MOBILE[name]);
    if (this.layout === 'tablet') p.shiftX *= 0.55;
    p.name = name.replace(/End$/, '');
    return p;
  }

  measure() {
    const w = window.innerWidth;
    const vh = window.innerHeight;
    // Phones and portrait tablets share the stacked (scene above text) composition.
    const stacked = w < 760 || (w < 1100 && vh > w * 1.15);
    this.layout = stacked ? 'mobile' : w < 1100 ? 'tablet' : 'desktop';
    this.vh = vh;
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    const keys = [];
    this.tops = [];
    for (const sec of this.sections) {
      const name = sec.dataset.scene;
      const top = sec.getBoundingClientRect().top + window.scrollY;
      const h = sec.offsetHeight;
      this.tops.push({ name, id: sec.id, top, height: h });
      let a = top - vh * 0.12;
      let b = top + h - vh * 0.88;
      if (name === 'home') { a = 0; b = 0; }
      a = clamp(a, 0, this.maxScroll);
      b = clamp(Math.max(a, b), 0, this.maxScroll);
      const start = this.preset(name);
      const end = PRESETS[`${name}End`]
        ? this.preset(`${name}End`)
        : name === 'home' ? start : { ...start, dist: start.dist * 1.08, az: start.az + 0.05 };
      keys.push({ y: a, p: start, base: start }, { y: b, p: end, base: start });
    }
    for (let i = 1; i < keys.length; i++) keys[i].y = Math.max(keys[i].y, keys[i - 1].y);
    this.keys = keys;

    // Moon sits behind-right of Earth as seen from the "profile" camera.
    const az = this.preset('profile').az;
    const ox = 0.75 * Math.sin(az) + 0.65 * Math.cos(az);
    const oz = 0.75 * Math.cos(az) - 0.65 * Math.sin(az);
    this.moonAngle = Math.atan2(oz, ox);
    // Spin Earth so India faces the opening camera.
    const homeAz = this.preset('home').az;
    this.spinBase = Math.atan2(-Math.cos(homeAz), Math.sin(homeAz)) - 73 * (Math.PI / 180) - 0.12;
  }

  setTarget(y) { this.target = y; }

  update(dt) {
    if (this.reducedMotion || this.damping === false) {
      this.current = this.target;
      return;
    }
    const k = 1 - Math.exp(-dt * 7.5);
    this.current += (this.target - this.current) * k;
    if (Math.abs(this.target - this.current) < 0.25) this.current = this.target;
  }

  /** Camera state at the smoothed scroll position. */
  state(time) {
    const y = this.current;
    const keys = this.keys;
    let i = 0;
    while (i < keys.length - 2 && y >= keys[i + 1].y) i++;
    const A = keys[i];
    const B = keys[i + 1] || A;
    const span = B.y - A.y;
    let t = span > 0 ? clamp((y - A.y) / span) : y >= B.y ? 1 : 0;
    const sameSection = A.p.name === B.p.name;

    let s;
    if (this.reducedMotion) {
      // Discrete states; the stage cross-fades between them (see main.js).
      const pick = sameSection || t < 0.5 ? A.base : B.base;
      s = { ...pick };
    } else {
      if (!sameSection) t = easeInOutCubic(t);
      s = {};
      for (const key of KEYS) {
        s[key] = key === 'dist'
          ? Math.exp(lerp(Math.log(A.p.dist), Math.log(B.p.dist), t))
          : lerp(A.p[key], B.p[key], t);
      }
      s.name = t < 0.5 ? A.p.name : B.p.name;
    }

    const progress = y / this.maxScroll;
    s.progress = progress;
    s.moonAngle = this.moonAngle;
    s.spin = this.spinBase + time * 0.012 + progress * 1.6;
    s.orbitPhase = progress * 2.2;
    return s;
  }

  /** Index + name of the section currently occupying the viewport centre. */
  activeSection() {
    const mid = this.target + this.vh * 0.5;
    let idx = 0;
    this.tops.forEach((t, i) => { if (t.top <= mid) idx = i; });
    const name = this.tops[idx]?.name;
    return { index: idx, name, label: SECTOR_NAMES[name] || '' };
  }

  /** 0→1 progress of a section through the viewport (for local effects). */
  sectionProgress(id, offset = 0.6) {
    const t = this.tops.find((s) => s.id === id);
    if (!t) return 0;
    return clamp((this.target + this.vh * offset - t.top) / t.height);
  }
}
