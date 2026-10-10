/**
 * SpaceScene — native WebGL renderer for the Earth → solar-system journey.
 *
 * The scene is a real (artistically scaled) 3D model: the Sun sits at the
 * origin, planets travel on circular orbits, and the camera is placed each
 * frame from a scroll-driven "camera state" supplied by ScrollController.
 * Earth's texture is generated on the GPU at start-up from simplified
 * coastline polygons, so no external image assets are required.
 */

import * as S from './shaders.js';
import { LAND, WATER, HOME_LAT_LON } from './earth-data.js';
import {
  mat4, multiply, perspective, lookAt, modelMatrix, orbitMatrix,
  transformPoint, seededRandom, clamp,
} from './gl-math.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const EARTH_POS = [30, 0, 0];
const EARTH_TILT = 23.4 * DEG;
const MOON = { r: 0.27, orbit: 3.4, incline: 0.09 };
const SUN_R = 6;

const PLANETS = [
  { name: 'Mercury', sub: '0.39 AU', r: 0.38, orbit: 13, phase: 2.2, kind: 0, a: [0.56, 0.53, 0.5], b: [0.34, 0.32, 0.31], seed: 1.3 },
  { name: 'Venus', sub: '0.72 AU', r: 0.9, orbit: 19.5, phase: 4.0, kind: 2, a: [0.84, 0.72, 0.5], b: [0.97, 0.88, 0.68], seed: 2.1 },
  { name: 'Mars', sub: '1.52 AU', r: 0.55, orbit: 40, phase: 0.85, kind: 0, a: [0.74, 0.35, 0.18], b: [0.46, 0.2, 0.12], seed: 3.7 },
  { name: 'Jupiter', sub: '5.20 AU', r: 3.2, orbit: 58, phase: 2.6, kind: 1, a: [0.82, 0.68, 0.52], b: [0.56, 0.38, 0.26], seed: 4.2 },
  { name: 'Saturn', sub: '9.58 AU', r: 2.6, orbit: 78, phase: 4.5, kind: 1, a: [0.9, 0.82, 0.62], b: [0.72, 0.62, 0.44], seed: 5.9, ring: true, tilt: 0.42 },
  { name: 'Uranus', sub: '19.2 AU', r: 1.7, orbit: 96, phase: 1.5, kind: 2, a: [0.56, 0.8, 0.85], b: [0.7, 0.9, 0.93], seed: 6.4 },
  { name: 'Neptune', sub: '30.1 AU', r: 1.6, orbit: 112, phase: 5.3, kind: 1, a: [0.24, 0.4, 0.86], b: [0.36, 0.56, 0.96], seed: 7.7 },
];

export class SpaceScene {
  /**
   * @param {HTMLCanvasElement} canvas  WebGL canvas
   * @param {HTMLCanvasElement} labelCanvas  2D overlay for mission labels
   * @param {object} quality  { dpr, stars, dust, lon, lat, textureSize }
   * @param {object} hooks  { onContextLost, onContextRestored }
   */
  constructor(canvas, labelCanvas, quality, hooks = {}) {
    this.canvas = canvas;
    this.labelCanvas = labelCanvas;
    this.lctx = labelCanvas.getContext('2d');
    this.quality = { ...quality };
    this.hooks = hooks;
    this.view = mat4();
    this.proj = mat4();
    this.viewProj = mat4();
    this.model = mat4();
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.labelsDrawn = false;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
      this.hooks.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        this.init();
        this.hooks.onContextRestored?.();
      } catch (err) {
        console.warn('WebGL restore failed', err);
      }
    });

    this.init();
  }

  init() {
    const opts = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

    this.programs = {
      earth: this.program(S.SPHERE_VS, S.EARTH_FS),
      planet: this.program(S.SPHERE_VS, S.PLANET_FS),
      sun: this.program(S.SPHERE_VS, S.SUN_FS),
      ring: this.program(S.RING_VS, S.RING_FS),
      line: this.program(S.LINE_VS, S.LINE_FS),
      points: this.program(S.POINTS_VS, S.POINTS_FS),
      glow: this.program(S.GLOW_VS, S.GLOW_FS),
    };

    this.buffers = {
      sphere: this.sphereMesh(this.quality.lon, this.quality.lat),
      sphereLow: this.sphereMesh(48, 32),
      orbit: this.orbitMesh(256),
      quad: this.staticBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])),
      ring: this.staticBuffer(new Float32Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1])),
      stars: this.pointCloud(this.makeStars(this.quality.stars)),
      dust: this.pointCloud(this.makeDust(this.quality.dust)),
    };

    this.bakeEarthTextures();
    this.loadOptionalEarthTexture();
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* GL helpers                                                          */
  /* ------------------------------------------------------------------ */

  program(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const attribs = {};
    return {
      p,
      u: (name) => (name in uniforms ? uniforms[name] : (uniforms[name] = gl.getUniformLocation(p, name))),
      a: (name) => (name in attribs ? attribs[name] : (attribs[name] = gl.getAttribLocation(p, name))),
    };
  }

  staticBuffer(data, target) {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
    gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  sphereMesh(lonSeg, latSeg) {
    const gl = this.gl;
    const verts = [];
    const idx = [];
    for (let iy = 0; iy <= latSeg; iy++) {
      const v = iy / latSeg;
      const lat = (v - 0.5) * Math.PI;
      for (let ix = 0; ix <= lonSeg; ix++) {
        const u = ix / lonSeg;
        const lon = (u - 0.5) * TAU;
        verts.push(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), u, v);
      }
    }
    const row = lonSeg + 1;
    for (let iy = 0; iy < latSeg; iy++) {
      for (let ix = 0; ix < lonSeg; ix++) {
        const a = iy * row + ix;
        const b = a + row;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return {
      vbo: this.staticBuffer(new Float32Array(verts)),
      ibo: this.staticBuffer(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER),
      count: idx.length,
    };
  }

  orbitMesh(segments) {
    const t = new Float32Array(segments + 1);
    for (let i = 0; i <= segments; i++) t[i] = i / segments;
    return { vbo: this.staticBuffer(t), count: segments + 1 };
  }

  pointCloud({ pos, data, col }) {
    return {
      pos: this.staticBuffer(pos),
      data: this.staticBuffer(data),
      col: this.staticBuffer(col),
      count: pos.length / 3,
    };
  }

  makeStars(count) {
    const rand = seededRandom(1977);
    const pos = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    const n = [0.33, 0.87, 0.36];
    for (let i = 0; i < count; i++) {
      const z = rand() * 2 - 1;
      const phi = rand() * TAU;
      const rr = Math.sqrt(1 - z * z);
      let d = [rr * Math.cos(phi), z, rr * Math.sin(phi)];
      if (i < count * 0.4) {
        // concentrate a share of stars along a faint galactic band
        const k = (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) * (0.75 + rand() * 0.25);
        d = [d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k];
        const l = Math.hypot(d[0], d[1], d[2]);
        d = d.map((c) => c / l);
      }
      const radius = 1700 + rand() * 600;
      pos.set([d[0] * radius, d[1] * radius, d[2] * radius], i * 3);

      const r = rand();
      const size = r < 0.78 ? 0.9 + rand() * 0.9 : r < 0.965 ? 1.8 + rand() * 1.0 : 2.8 + rand() * 1.4;
      const bright = r < 0.78 ? 0.3 + rand() * 0.5 : 0.65 + rand() * 0.35;
      const twinkle = rand() < 0.35 ? 0.25 + rand() * 0.5 : 0;
      data.set([size, rand() * TAU, twinkle, 0.6 + rand() * 1.8], i * 4);

      const t = rand();
      const c = t < 0.25 ? [0.72, 0.83, 1] : t < 0.85 ? [0.95, 0.96, 1] : [1, 0.86, 0.7];
      col.set([c[0] * bright, c[1] * bright, c[2] * bright], i * 3);
    }
    return { pos, data, col };
  }

  makeDust(count) {
    const rand = seededRandom(42);
    const pos = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let p;
      if (i < count * 0.45) {
        // motes around Earth: parallax cue during the first pull-back
        const z = rand() * 2 - 1;
        const phi = rand() * TAU;
        const rr = Math.sqrt(1 - z * z);
        const rad = 2.2 + Math.pow(rand(), 0.7) * 26;
        p = [EARTH_POS[0] + rr * Math.cos(phi) * rad, z * rad * 0.6, EARTH_POS[2] + rr * Math.sin(phi) * rad];
      } else {
        // thin disc across the system
        const a = rand() * TAU;
        const rad = 8 + rand() * 150;
        p = [Math.cos(a) * rad, (rand() + rand() + rand() - 1.5) * 5, Math.sin(a) * rad];
      }
      pos.set(p, i * 3);
      data.set([0.9 + rand() * 0.9, rand() * TAU, rand() * 0.4, 0.5 + rand()], i * 4);
      const b = 0.22 + rand() * 0.3;
      col.set([0.62 * b, 0.76 * b, 1.0 * b], i * 3);
    }
    return { pos, data, col };
  }

  canvasTexture(source, repeatS) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatS ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  finishMipmaps(tex) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    if (this.aniso) {
      const max = gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Earth texture generation                                            */
  /* ------------------------------------------------------------------ */

  static landMask(width = 1024, height = 512) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const draw = (polys, color) => {
      ctx.fillStyle = color;
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
    draw(LAND, '#fff');
    draw(WATER, '#000');
    return c;
  }

  /** Repeated 2× downsampling = cheap, portable box blur. */
  static downsample(src, targetWidth) {
    let cur = src;
    while (cur.width > targetWidth) {
      const next = document.createElement('canvas');
      next.width = cur.width / 2;
      next.height = cur.height / 2;
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }
    return cur;
  }

  bakeEarthTextures() {
    const gl = this.gl;
    const mask = SpaceScene.landMask();
    const maskTex = this.canvasTexture(mask, true);
    const coastTex = this.canvasTexture(SpaceScene.downsample(mask, 256), true);

    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const w = Math.min(this.quality.textureSize, maxSize);
    const h = w / 2;
    const prog = this.programs.bake || (this.programs.bake = this.program(S.BAKE_VS, S.BAKE_FS));

    const bake = (pass) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(prog.p);
      [maskTex, coastTex].forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform1i(prog.u('u_mask'), 0);
      gl.uniform1i(prog.u('u_coast'), 1);
      gl.uniform1f(prog.u('u_pass'), pass);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
      gl.enableVertexAttribArray(prog.a('a_pos'));
      gl.vertexAttribPointer(prog.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(prog.a('a_pos'));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.activeTexture(gl.TEXTURE0);
      this.finishMipmaps(tex);
      return tex;
    };

    this.earthAlbedo = bake(0);
    this.earthClouds = bake(1);
    [maskTex, coastTex].forEach((t) => gl.deleteTexture(t));
  }

  /**
   * Optional photographic texture: set data-earth-texture on the canvas to an
   * equirectangular day map (e.g. NASA Blue Marble). Ocean specular is lost,
   * but the procedural clouds and lighting still apply.
   */
  loadOptionalEarthTexture() {
    const url = this.canvas.dataset.earthTexture;
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!this.gl) return;
      const gl = this.gl;
      const c = document.createElement('canvas');
      c.width = 2048;
      c.height = 1024;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const tex = this.canvasTexture(c, true);
      this.finishMipmaps(tex);
      gl.deleteTexture(this.earthAlbedo);
      this.earthAlbedo = tex;
    };
    img.src = url;
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                                */
  /* ------------------------------------------------------------------ */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.dpr = dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ldpr = Math.min(window.devicePixelRatio || 1, 2);
    this.labelDpr = ldpr;
    this.labelCanvas.width = Math.round(this.labelCanvas.clientWidth * ldpr);
    this.labelCanvas.height = Math.round(this.labelCanvas.clientHeight * ldpr);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  setResolutionScale(dprCap) {
    this.quality.dpr = dprCap;
    this.resize();
  }

  /** World positions of every body at a given time / scroll phase. */
  layout(state, time) {
    const earth = EARTH_POS;
    const moonA = state.moonAngle + Math.sin(time * 0.05) * 0.25;
    const ci = Math.cos(MOON.incline), si = Math.sin(MOON.incline);
    const moon = [
      earth[0] + Math.cos(moonA) * MOON.orbit,
      earth[1] - si * Math.sin(moonA) * MOON.orbit,
      earth[2] + ci * Math.sin(moonA) * MOON.orbit,
    ];
    const planets = PLANETS.map((p) => {
      const speed = 0.022 * Math.pow(13 / p.orbit, 1.5);
      const a = p.phase + time * speed + state.orbitPhase * Math.pow(13 / p.orbit, 0.5);
      return { ...p, pos: [Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit] };
    });
    return { earth, moon, planets };
  }

  render(state, time) {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;

    const W = this.canvas.width;
    const H = this.canvas.height;
    const aspect = W / H;

    // Camera: spherical offset around a target that slides from Earth to the Sun.
    const target = [EARTH_POS[0] * (1 - state.focus), 0, EARTH_POS[2] * (1 - state.focus)];
    const ce = Math.cos(state.el);
    const dir = [-ce * Math.cos(state.az), Math.sin(state.el), ce * Math.sin(state.az)];
    const eye = [target[0] + dir[0] * state.dist, target[1] + dir[1] * state.dist, target[2] + dir[2] * state.dist];
    this.eye = eye;

    // Keep horizontal coverage reasonable on portrait screens.
    const fovY = aspect >= 1 ? 40 * DEG : 2 * Math.atan(Math.tan(18 * DEG) / aspect);
    this.fovY = fovY;
    const near = Math.max(0.02, state.dist * 0.02);
    perspective(this.proj, fovY, aspect, near, 6000);
    this.proj[8] = -state.shiftX;
    this.proj[9] = -state.shiftY;
    lookAt(this.view, eye, target, [0, 1, 0]);
    multiply(this.viewProj, this.proj, this.view);

    const right = [this.view[0], this.view[4], this.view[8]];
    const up = [this.view[1], this.view[5], this.view[9]];
    const bodies = this.layout(state, time);
    this.lastBodies = bodies;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.006, 0.01, 0.024, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1. Stars (background, additive, no depth)
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawPoints(this.buffers.stars, time, 0, 1);

    // 2. Opaque bodies
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.drawSun(time, eye);
    this.drawEarth(state, time, eye);
    this.drawPlanet({ pos: bodies.moon, r: MOON.r, kind: 0, a: [0.64, 0.63, 0.61], b: [0.4, 0.39, 0.38], seed: 9.1 }, eye, false, 1);
    const planetFade = clamp(state.orbits * 1.5);
    if (planetFade > 0.01) for (const p of bodies.planets) this.drawPlanet(p, eye, true, planetFade);

    // 3. Transparent: rings, orbits, dust, glows
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (planetFade > 0.01) for (const p of bodies.planets) if (p.ring) this.drawRing(p, planetFade);

    gl.blendFunc(gl.ONE, gl.ONE);
    if (state.orbits > 0.01) {
      for (const p of bodies.planets) this.drawOrbit([0, 0, 0], p.orbit, 0, 0.14 * state.orbits);
      this.drawOrbit([0, 0, 0], 30, 0, 0.2 * state.orbits, [0.86, 1.0, state.trajectory]);
    }
    if (state.moonOrbit > 0.01) {
      this.drawOrbit(EARTH_POS, MOON.orbit, MOON.incline, 0.22 * state.moonOrbit);
    }
    this.drawPoints(this.buffers.dust, time, 1, state.dust);

    this.drawGlows(bodies, eye, right, up);

    gl.depthMask(true);
    this.drawLabels(state, bodies);
  }

  bindSphere(prog, mesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.enableVertexAttribArray(prog.a('a_position'));
    gl.vertexAttribPointer(prog.a('a_position'), 3, gl.FLOAT, false, 20, 0);
    const uv = prog.a('a_uv');
    if (uv >= 0) {
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.uniformMatrix4fv(prog.u('u_view'), false, this.view);
    gl.uniformMatrix4fv(prog.u('u_proj'), false, this.proj);
  }

  unbindSphere(prog) {
    const gl = this.gl;
    gl.disableVertexAttribArray(prog.a('a_position'));
    const uv = prog.a('a_uv');
    if (uv >= 0) gl.disableVertexAttribArray(uv);
  }

  drawEarth(state, time, eye) {
    const gl = this.gl;
    const prog = this.programs.earth;
    gl.useProgram(prog.p);
    this.bindSphere(prog, this.buffers.sphere);
    modelMatrix(this.model, EARTH_POS, 1, state.spin, EARTH_TILT);
    gl.uniformMatrix4fv(prog.u('u_model'), false, this.model);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.earthAlbedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.earthClouds);
    gl.uniform1i(prog.u('u_albedo'), 0);
    gl.uniform1i(prog.u('u_clouds'), 1);
    const l = Math.hypot(...EARTH_POS);
    gl.uniform3f(prog.u('u_lightDir'), -EARTH_POS[0] / l, -EARTH_POS[1] / l, -EARTH_POS[2] / l);
    gl.uniform3fv(prog.u('u_camPos'), eye);
    gl.uniform1f(prog.u('u_cloudOffset'), (time * 0.0016) % 1);
    gl.uniform1f(prog.u('u_time'), time);
    const [lat, lon] = HOME_LAT_LON;
    gl.uniform3f(prog.u('u_markerDir'), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG));
    gl.uniform1f(prog.u('u_marker'), state.marker);
    gl.drawElements(gl.TRIANGLES, this.buffers.sphere.count, gl.UNSIGNED_SHORT, 0);
    this.unbindSphere(prog);
    gl.activeTexture(gl.TEXTURE0);
  }

  drawPlanet(p, eye, low, fade) {
    const gl = this.gl;
    const prog = this.programs.planet;
    const mesh = low ? this.buffers.sphereLow : this.buffers.sphere;
    gl.useProgram(prog.p);
    this.bindSphere(prog, mesh);
    modelMatrix(this.model, p.pos, p.r, 0, p.tilt || 0);
    gl.uniformMatrix4fv(prog.u('u_model'), false, this.model);
    gl.uniform3fv(prog.u('u_camPos'), eye);
    gl.uniform3fv(prog.u('u_colorA'), p.a);
    gl.uniform3fv(prog.u('u_colorB'), p.b);
    gl.uniform1f(prog.u('u_kind'), p.kind);
    gl.uniform1f(prog.u('u_seed'), p.seed);
    gl.uniform1f(prog.u('u_fade'), fade);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    this.unbindSphere(prog);
  }

  drawSun(time, eye) {
    const gl = this.gl;
    const prog = this.programs.sun;
    gl.useProgram(prog.p);
    this.bindSphere(prog, this.buffers.sphereLow);
    modelMatrix(this.model, [0, 0, 0], SUN_R, time * 0.01, 0);
    gl.uniformMatrix4fv(prog.u('u_model'), false, this.model);
    gl.uniform3fv(prog.u('u_camPos'), eye);
    gl.uniform1f(prog.u('u_time'), time);
    gl.drawElements(gl.TRIANGLES, this.buffers.sphereLow.count, gl.UNSIGNED_SHORT, 0);
    this.unbindSphere(prog);
  }

  drawRing(p, fade) {
    const gl = this.gl;
    const prog = this.programs.ring;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.ring);
    gl.enableVertexAttribArray(prog.a('a_position'));
    gl.vertexAttribPointer(prog.a('a_position'), 3, gl.FLOAT, false, 0, 0);
    modelMatrix(this.model, p.pos, p.r * 2.3, 0, p.tilt || 0);
    gl.uniformMatrix4fv(prog.u('u_model'), false, this.model);
    gl.uniformMatrix4fv(prog.u('u_view'), false, this.view);
    gl.uniformMatrix4fv(prog.u('u_proj'), false, this.proj);
    gl.uniform3f(prog.u('u_color'), 0.86, 0.78, 0.62);
    gl.uniform1f(prog.u('u_inner'), 1.25 / 2.3);
    gl.uniform3fv(prog.u('u_planetPos'), p.pos);
    gl.uniform1f(prog.u('u_planetR'), p.r);
    gl.uniform1f(prog.u('u_alpha'), fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(prog.a('a_position'));
  }

  drawOrbit(center, radius, incline, alpha, highlight) {
    const gl = this.gl;
    const prog = this.programs.line;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.orbit.vbo);
    gl.enableVertexAttribArray(prog.a('a_t'));
    gl.vertexAttribPointer(prog.a('a_t'), 1, gl.FLOAT, false, 0, 0);
    orbitMatrix(this.model, center, radius, incline);
    gl.uniformMatrix4fv(prog.u('u_model'), false, this.model);
    gl.uniformMatrix4fv(prog.u('u_view'), false, this.view);
    gl.uniformMatrix4fv(prog.u('u_proj'), false, this.proj);
    gl.uniform4f(prog.u('u_color'), 0.6, 0.75, 1.0, alpha);
    const h = highlight || [0, 0, 0];
    gl.uniform4f(prog.u('u_highlight'), h[0], h[1], h[2], 0);
    gl.drawArrays(gl.LINE_STRIP, 0, this.buffers.orbit.count);
    gl.disableVertexAttribArray(prog.a('a_t'));
  }

  drawPoints(cloud, time, attenuate, alpha) {
    if (alpha <= 0.001) return;
    const gl = this.gl;
    const prog = this.programs.points;
    gl.useProgram(prog.p);
    const bind = (buf, name, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(prog.a(name));
      gl.vertexAttribPointer(prog.a(name), size, gl.FLOAT, false, 0, 0);
    };
    bind(cloud.pos, 'a_position', 3);
    bind(cloud.data, 'a_data', 4);
    bind(cloud.col, 'a_color', 3);
    gl.uniformMatrix4fv(prog.u('u_view'), false, this.view);
    gl.uniformMatrix4fv(prog.u('u_proj'), false, this.proj);
    gl.uniform1f(prog.u('u_time'), time);
    gl.uniform1f(prog.u('u_dpr'), this.dpr);
    gl.uniform1f(prog.u('u_attenuate'), attenuate);
    gl.uniform1f(prog.u('u_alpha'), alpha);
    gl.drawArrays(gl.POINTS, 0, cloud.count);
    ['a_position', 'a_data', 'a_color'].forEach((n) => gl.disableVertexAttribArray(prog.a(n)));
  }

  drawGlows(bodies, eye, right, up) {
    const gl = this.gl;
    const prog = this.programs.glow;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
    gl.enableVertexAttribArray(prog.a('a_corner'));
    gl.vertexAttribPointer(prog.a('a_corner'), 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(prog.u('u_view'), false, this.view);
    gl.uniformMatrix4fv(prog.u('u_proj'), false, this.proj);
    gl.uniform3fv(prog.u('u_right'), right);
    gl.uniform3fv(prog.u('u_up'), up);

    const glow = (center, radius, scale, o) => {
      const dx = eye[0] - center[0], dy = eye[1] - center[1], dz = eye[2] - center[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= radius * 1.01) return;
      const silhouette = radius / Math.sqrt(1 - (radius / d) ** 2);
      const size = silhouette * scale;
      // pull the billboard toward the camera so bodies in front still occlude it
      const k = (radius * 0.98) / d;
      gl.uniform3f(prog.u('u_center'), center[0] + dx * k, center[1] + dy * k, center[2] + dz * k);
      gl.uniform1f(prog.u('u_size'), size * (1 - k));
      gl.uniform1f(prog.u('u_inner'), 1 / scale);
      gl.uniform3fv(prog.u('u_color'), o.color);
      gl.uniform1f(prog.u('u_intensity'), o.intensity);
      gl.uniform1f(prog.u('u_falloff'), o.falloff);
      gl.uniform1f(prog.u('u_directional'), o.directional || 0);
      gl.uniform1f(prog.u('u_rim'), o.rim || 0);
      gl.uniform2fv(prog.u('u_light2d'), o.light2d || [0, 0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    // Earth atmosphere, brighter toward the Sun
    const L = [-EARTH_POS[0], -EARTH_POS[1], -EARTH_POS[2]];
    let lx = L[0] * right[0] + L[1] * right[1] + L[2] * right[2];
    let ly = L[0] * up[0] + L[1] * up[1] + L[2] * up[2];
    const ll = Math.hypot(lx, ly) || 1;
    glow(EARTH_POS, 1, 1.32, { color: [0.3, 0.6, 1.0], intensity: 0.95, falloff: 9, directional: 1, rim: 0.55, light2d: [lx / ll, ly / ll] });

    // Sun corona: tight + wide layer
    glow([0, 0, 0], SUN_R, 2.2, { color: [1.0, 0.62, 0.25], intensity: 0.9, falloff: 4.2, rim: 0.3 });
    glow([0, 0, 0], SUN_R, 7, { color: [1.0, 0.5, 0.2], intensity: 0.32, falloff: 1.1 });

    gl.disableVertexAttribArray(prog.a('a_corner'));
  }

  /* ------------------------------------------------------------------ */
  /* Mission labels (2D overlay)                                         */
  /* ------------------------------------------------------------------ */

  project(p) {
    const c = transformPoint(this.viewProj, p);
    if (c[3] <= 0.0001) return null;
    return {
      x: (c[0] / c[3] * 0.5 + 0.5) * this.width,
      y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * this.height,
      w: c[3],
    };
  }

  drawLabels(state, bodies) {
    const ctx = this.lctx;
    const d = this.labelDpr;
    const far = state.labels;
    const near = state.nearLabels;
    if (far < 0.01 && near < 0.01) {
      if (this.labelsDrawn) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
        this.labelsDrawn = false;
      }
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.labelsDrawn = true;

    const items = [
      { name: 'Earth', sub: 'Origin · 1.00 AU', pos: bodies.earth, r: 1, alpha: Math.max(near, far) },
      { name: 'Luna', sub: '384,400 km', pos: bodies.moon, r: MOON.r, alpha: near },
      { name: 'Sol', sub: 'G-type star', pos: [0, 0, 0], r: SUN_R, alpha: far },
      ...bodies.planets.map((p) => ({ name: p.name, sub: p.sub, pos: p.pos, r: p.r, alpha: far * clamp(state.orbits * 1.5) })),
    ];
    const pxPerUnit = this.height / (2 * Math.tan(this.fovY / 2));
    const small = this.width < 640;

    for (const it of items) {
      if (it.alpha < 0.01) continue;
      const s = this.project(it.pos);
      if (!s) continue;
      if (s.x < -40 || s.x > this.width + 40 || s.y < -40 || s.y > this.height + 40) continue;
      const rad = clamp((it.r * pxPerUnit) / s.w, 1.5, 400);
      if (rad > 120) continue; // body is too close to need a label
      const ring = rad + 6;
      ctx.globalAlpha = it.alpha;
      ctx.strokeStyle = 'rgba(150, 205, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let q = 0; q < 4; q++) {
        const a0 = q * (Math.PI / 2) + 0.25;
        ctx.moveTo(s.x + Math.cos(a0) * ring, s.y + Math.sin(a0) * ring);
        ctx.arc(s.x, s.y, ring, a0, a0 + Math.PI / 2 - 0.5);
      }
      ctx.stroke();

      const sx = s.x + ring * 0.72;
      const sy = s.y - ring * 0.72;
      const ex = sx + 14;
      const ey = sy - 14;
      const len = small ? 44 : 62;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex + len, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 240, 255, 0.92)';
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(it.name.toUpperCase(), ex + 2, ey - 5);
      if (!small) {
        ctx.fillStyle = 'rgba(150, 170, 200, 0.85)';
        ctx.font = '400 9px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(it.sub.toUpperCase(), ex + 2, ey + 11);
      }
    }
    ctx.globalAlpha = 1;
  }
}
