/**
 * GLSL ES 1.00 shader sources for the space scene (WebGL 1 for broad support).
 */

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/* Hash-based 3D value noise + fBm. Sampling 3D noise on the unit sphere keeps
   procedural textures seamless (no seam at the antimeridian, no polar pinch). */
const NOISE = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.96875;
}
float fbm3(vec3 p) {
  return (noise(p) * 0.5714 + noise(p * 2.03 + vec3(1.7, 9.2, 3.1)) * 0.2857 + noise(p * 4.12 + vec3(4.1, 2.3, 7.7)) * 0.1429);
}
`;

/* ---------- Texture baking (runs once at start-up) ---------- */

export const BAKE_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const BAKE_FS = `${PRECISION}
uniform sampler2D u_mask;
uniform sampler2D u_coast;
uniform float u_pass;
varying vec2 v_uv;
${NOISE}
float blob(float lon, float lat, float lon0, float lat0, float rx, float ry) {
  float dl = degrees(lon) - lon0;
  dl = dl - 360.0 * floor((dl + 180.0) / 360.0);
  float dp = degrees(lat) - lat0;
  return exp(-(dl * dl) / (rx * rx) - (dp * dp) / (ry * ry));
}
void main() {
  float lat = (v_uv.y - 0.5) * 3.14159265;
  float lon = (v_uv.x - 0.5) * 6.28318531;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float latDeg = degrees(lat);
  float alat = abs(latDeg);

  float sharp = texture2D(u_mask, v_uv).r;
  float coast = texture2D(u_coast, v_uv).r;
  
  float n1 = fbm(dir * 3.0 + vec3(1.7));
  float n2 = fbm(dir * 9.0 + vec3(5.2));
  float n3 = fbm3(dir * 28.0);

  float m = mix(sharp, coast, 0.2) + (fbm(dir * 7.0) - 0.5) * 0.32 + (n3 - 0.5) * 0.1;
  float land = smoothstep(0.47, 0.53, m);

  // Arid regions as soft lon/lat blobs (artistic, not climatological data).
  float dry = 0.0;
  dry += blob(lon, lat, 12.0, 23.0, 30.0, 9.0);    // Sahara
  dry += blob(lon, lat, 46.0, 23.0, 11.0, 8.0);    // Arabia
  dry += blob(lon, lat, 60.0, 31.0, 11.0, 6.0);    // Iran / Pakistan
  dry += blob(lon, lat, 62.0, 43.0, 10.0, 4.5);    // Central Asian steppe
  dry += blob(lon, lat, 100.0, 42.0, 14.0, 4.5);   // Gobi
  dry += blob(lon, lat, 84.0, 39.0, 7.0, 3.0);     // Taklamakan
  dry += blob(lon, lat, 132.0, -25.0, 14.0, 7.0);  // Australian interior
  dry += blob(lon, lat, 19.0, -24.0, 6.0, 5.0);    // Kalahari / Namib
  dry += blob(lon, lat, -111.0, 33.0, 7.0, 6.0);   // US south-west
  dry += blob(lon, lat, -69.5, -24.0, 2.5, 7.0);   // Atacama
  dry += blob(lon, lat, -68.0, -40.0, 4.0, 6.0);   // Patagonia
  dry += blob(lon, lat, 72.0, 26.0, 4.0, 3.0);     // Thar
  float desert = smoothstep(0.35, 0.85, dry + (n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.25);
  float tropic = 1.0 - smoothstep(6.0, 18.0, alat);
  float boreal = smoothstep(50.0, 60.0, alat);
  float ice = smoothstep(64.0, 72.0, alat + (n1 - 0.5) * 14.0);
  if (latDeg < -60.0) ice = 1.0;
  float band = 1.0 - smoothstep(7.0, 17.0, abs(alat - 23.0));

  if (u_pass < 0.5) {
    vec3 cJungle = vec3(0.05, 0.19, 0.07);
    vec3 cForest = vec3(0.11, 0.24, 0.10);
    vec3 cGrass = vec3(0.36, 0.40, 0.20);
    vec3 cDesert = vec3(0.82, 0.67, 0.45);
    vec3 cDesert2 = vec3(0.66, 0.44, 0.27);
    vec3 cTundra = vec3(0.36, 0.37, 0.30);
    vec3 cIce = vec3(0.93, 0.96, 1.0);

    float n4 = fbm3(dir * 60.0 + vec3(3.3));
    vec3 lc = mix(cForest, cGrass, smoothstep(0.3, 0.8, n2 + (n4 - 0.5) * 0.4));
    lc = mix(lc, cJungle, tropic * 0.75);
    lc = mix(lc, mix(cGrass * 1.1, vec3(0.55, 0.46, 0.3), n2), smoothstep(0.15, 0.5, dry) * 0.6);
    lc = mix(lc, mix(cDesert, cDesert2, smoothstep(0.3, 0.7, n2 + (n4 - 0.5) * 0.5)), desert);
    lc = mix(lc, cTundra, boreal * 0.7);
    lc *= 0.74 + 0.3 * n3 + 0.22 * n4;
    lc = mix(lc, cIce, ice);

    vec3 deep = vec3(0.010, 0.045, 0.15);
    vec3 mid = vec3(0.020, 0.10, 0.28);
    vec3 shallow = vec3(0.05, 0.30, 0.44);
    vec3 oc = mix(deep, mid, clamp(smoothstep(0.0, 0.35, coast) + (n1 - 0.5) * 0.35, 0.0, 1.0));
    oc = mix(oc, shallow, smoothstep(0.35, 0.8, coast) * 0.65);
    float seaIce = smoothstep(77.0, 84.0, latDeg + (n2 - 0.5) * 10.0);
    oc = mix(oc, cIce * 0.88, seaIce);

    vec3 col = mix(oc, lc, land);
    gl_FragColor = vec4(col, (1.0 - land) * (1.0 - seaIce));
  } else {
    vec3 p = dir * vec3(1.0, 1.7, 1.0);
    vec3 q = vec3(fbm3(p * 2.0), fbm3(p * 2.0 + vec3(5.2, 1.3, 2.8)), fbm3(p * 2.0 + vec3(1.1, 7.3, 3.7)));
    float c = fbm(p * 4.2 + q * 2.2);
    c += (fbm3(dir * 18.0 + q) - 0.5) * 0.22;
    c += 0.08 * exp(-pow(latDeg / 7.0, 2.0)) + 0.12 * exp(-pow((alat - 55.0) / 12.0, 2.0)) - 0.1 * band - 0.08 * desert;
    float cloud = smoothstep(0.48, 0.72, c);
    cloud *= 0.7 + 0.3 * fbm3(dir * 40.0);

    float lights = land * (1.0 - ice) * (1.0 - desert * 0.8);
    lights *= smoothstep(0.6, 0.9, noise(dir * 190.0)) * smoothstep(0.45, 0.7, fbm3(dir * 9.0 + vec3(9.1)));
    lights = clamp(lights * 1.6, 0.0, 1.0);
    lights *= 1.0 - smoothstep(50.0, 64.0, alat);
    gl_FragColor = vec4(cloud, lights, 0.0, 1.0);
  }
}
`;

/* ---------- Spheres ---------- */

export const SPHERE_VS = `
attribute vec3 a_position;
attribute vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_world;
varying vec3 v_obj;
void main() {
  vec4 w = u_model * vec4(a_position, 1.0);
  v_world = w.xyz;
  v_normal = (u_model * vec4(a_position, 0.0)).xyz;
  v_obj = a_position;
  v_uv = a_uv;
  gl_Position = u_proj * u_view * w;
}
`;

export const EARTH_FS = `${PRECISION}
uniform sampler2D u_albedo;
uniform sampler2D u_clouds;
uniform vec3 u_lightDir;
uniform vec3 u_camPos;
uniform float u_cloudOffset;
uniform float u_time;
uniform vec3 u_markerDir;
uniform float u_marker;
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_world;
varying vec3 v_obj;
void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_camPos - v_world);
  float NdL = dot(N, L);
  float diff = max(NdL, 0.0);

  vec4 alb = texture2D(u_albedo, v_uv);
  float cloud = texture2D(u_clouds, v_uv + vec2(u_cloudOffset, 0.0)).r;
  float shadow = texture2D(u_clouds, v_uv + vec2(u_cloudOffset - 0.0025, 0.0015)).r;
  float lights = texture2D(u_clouds, v_uv).g;

  vec3 surface = alb.rgb * (0.025 + 1.25 * diff);
  surface *= 1.0 - 0.35 * shadow * diff;

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 55.0) * alb.a * diff;
  surface += vec3(1.0, 0.93, 0.8) * spec * 0.65 * (1.0 - cloud);

  vec3 cloudCol = vec3(0.96, 0.98, 1.0) * (0.03 + 1.12 * diff);
  vec3 col = mix(surface, cloudCol, cloud * 0.92);

  float night = 1.0 - smoothstep(-0.22, 0.06, NdL);
  col += vec3(1.0, 0.70, 0.36) * lights * night * (1.0 - cloud * 0.85) * 1.35;

  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 atm = vec3(0.32, 0.62, 1.0);
  float lit = smoothstep(-0.35, 0.6, NdL);
  col = mix(col, atm * (0.08 + 1.25 * lit), fres * 0.8);
  col += atm * 0.05 * lit;

  float md = distance(normalize(v_obj), u_markerDir);
  float pulse = fract(u_time * 0.45);
  float ring = smoothstep(0.0035, 0.0, abs(md - (0.012 + pulse * 0.05))) * (1.0 - pulse);
  float dotm = smoothstep(0.0085, 0.0055, md);
  col = mix(col, vec3(0.55, 0.92, 1.0), clamp(dotm + ring * 0.85, 0.0, 1.0) * u_marker);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const PLANET_FS = `${PRECISION}
uniform vec3 u_camPos;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform float u_kind;
uniform float u_seed;
uniform float u_fade;
varying vec3 v_normal;
varying vec3 v_world;
varying vec3 v_obj;
${NOISE}
void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(-v_world);
  vec3 V = normalize(u_camPos - v_world);
  vec3 p = normalize(v_obj);
  vec3 s = vec3(u_seed);
  vec3 col;
  if (u_kind < 0.5) {
    float n = fbm(p * 3.0 + s);
    float maria = smoothstep(0.5, 0.58, fbm3(p * 1.6 + s * 1.7));
    col = mix(u_colorA, u_colorB, n);
    col *= 1.0 - 0.32 * maria;
    col *= 0.86 + 0.24 * noise(p * 26.0 + s);
  } else if (u_kind < 1.5) {
    float w = fbm(p * vec3(2.0, 6.0, 2.0) + s);
    float b = sin(p.y * 15.0 + w * 3.2) * 0.5 + 0.5;
    col = mix(u_colorA, u_colorB, b);
    col = mix(col, u_colorA * 1.08, smoothstep(0.6, 0.9, fbm3(p * 5.0 + s)) * 0.3);
  } else {
    float w = fbm(p * vec3(2.5, 4.0, 2.5) + s);
    col = mix(u_colorA, u_colorB, w);
  }
  float d = max(dot(N, L), 0.0);
  float wrap = smoothstep(-0.1, 0.45, dot(N, L));
  vec3 c = col * (0.018 + 1.12 * d);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += u_colorB * fres * 0.28 * wrap;
  gl_FragColor = vec4(c * u_fade, 1.0);
}
`;

export const SUN_FS = `${PRECISION}
uniform vec3 u_camPos;
uniform float u_time;
varying vec3 v_normal;
varying vec3 v_world;
varying vec3 v_obj;
${NOISE}
void main() {
  vec3 N = normalize(v_normal);
  vec3 V = normalize(u_camPos - v_world);
  float mu = max(dot(N, V), 0.0);
  vec3 p = normalize(v_obj);
  float g = fbm(p * 5.0 + vec3(u_time * 0.04));
  float g2 = noise(p * 32.0 + vec3(u_time * 0.15));
  vec3 core = vec3(1.0, 0.95, 0.82);
  vec3 edge = vec3(1.0, 0.46, 0.10);
  vec3 col = mix(edge, core, pow(mu, 0.42));
  col *= 0.82 + 0.32 * g + 0.1 * g2;
  gl_FragColor = vec4(col * 1.12, 1.0);
}
`;

/* ---------- Saturn's rings ---------- */

export const RING_VS = `
attribute vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
varying vec3 v_local;
varying vec3 v_world;
void main() {
  vec4 w = u_model * vec4(a_position, 1.0);
  v_local = a_position;
  v_world = w.xyz;
  gl_Position = u_proj * u_view * w;
}
`;

export const RING_FS = `${PRECISION}
uniform vec3 u_color;
uniform float u_inner;
uniform vec3 u_planetPos;
uniform float u_planetR;
uniform float u_alpha;
varying vec3 v_local;
varying vec3 v_world;
void main() {
  float r = length(v_local.xz);
  if (r > 1.0 || r < u_inner) discard;
  float t = (r - u_inner) / (1.0 - u_inner);
  float bands = 0.55 + 0.45 * sin(t * 70.0) * sin(t * 23.0 + 1.0);
  float gap = smoothstep(0.025, 0.0, abs(t - 0.64));
  float a = bands * (1.0 - gap * 0.9) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.88, t) * 0.8;
  vec3 L = normalize(-v_world);
  vec3 oc = v_world - u_planetPos;
  float b = dot(oc, L);
  float c = dot(oc, oc) - u_planetR * u_planetR;
  float h = b * b - c;
  float shadow = (h > 0.0 && -b + sqrt(h) > 0.0) ? 0.18 : 1.0;
  gl_FragColor = vec4(u_color * shadow, a * u_alpha);
}
`;

/* ---------- Orbit lines ---------- */

export const LINE_VS = `
attribute float a_t;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
varying float v_t;
void main() {
  float a = a_t * 6.28318531;
  v_t = a_t;
  gl_Position = u_proj * u_view * u_model * vec4(cos(a), 0.0, sin(a), 1.0);
}
`;

export const LINE_FS = `${PRECISION}
uniform vec4 u_color;
uniform vec4 u_highlight;
varying float v_t;
void main() {
  float h = u_highlight.z * smoothstep(u_highlight.x, u_highlight.y, v_t) * step(v_t, u_highlight.y + 0.0001);
  vec3 col = mix(u_color.rgb, vec3(0.45, 0.88, 1.0), clamp(h, 0.0, 1.0));
  float a = max(u_color.a, h * 0.95);
  gl_FragColor = vec4(col * a, a);
}
`;

/* ---------- Point sprites: stars + dust ---------- */

export const POINTS_VS = `
attribute vec3 a_position;
attribute vec4 a_data;
attribute vec3 a_color;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform float u_time;
uniform float u_dpr;
uniform float u_attenuate;
uniform float u_alpha;
varying vec3 v_color;
void main() {
  vec4 vp = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * vp;
  float dist = max(-vp.z, 0.001);
  float tw = 1.0 - a_data.z * (0.5 + 0.5 * sin(u_time * a_data.w + a_data.y));
  float size = a_data.x * mix(1.0, clamp(14.0 / dist, 0.5, 3.0), u_attenuate);
  float alpha = mix(1.0, clamp(9.0 / dist, 0.04, 1.0), u_attenuate);
  gl_PointSize = size * u_dpr;
  v_color = a_color * tw * alpha * u_alpha;
}
`;

export const POINTS_FS = `${PRECISION}
varying vec3 v_color;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(v_color * a * a, 1.0);
}
`;

/* ---------- Camera-facing glow billboards (atmosphere, sun corona) ---------- */

export const GLOW_VS = `
attribute vec2 a_corner;
uniform vec3 u_center;
uniform float u_size;
uniform vec3 u_right;
uniform vec3 u_up;
uniform mat4 u_view;
uniform mat4 u_proj;
varying vec2 v_c;
void main() {
  v_c = a_corner;
  vec3 p = u_center + (u_right * a_corner.x + u_up * a_corner.y) * u_size;
  gl_Position = u_proj * u_view * vec4(p, 1.0);
}
`;

export const GLOW_FS = `${PRECISION}
uniform float u_inner;
uniform vec3 u_color;
uniform vec2 u_light2d;
uniform float u_intensity;
uniform float u_falloff;
uniform float u_directional;
uniform float u_rim;
varying vec2 v_c;
void main() {
  float r = length(v_c);
  if (r > 1.0) discard;
  float x = r / u_inner;
  float a = x < 1.0 ? pow(x, 7.0) * u_rim : exp(-(x - 1.0) * u_falloff);
  vec2 dir = r > 0.0001 ? v_c / r : vec2(0.0);
  float dirF = mix(1.0, 0.18 + 1.0 * smoothstep(-0.75, 0.9, dot(dir, u_light2d)), u_directional);
  a *= dirF * smoothstep(1.0, 0.8, r);
  gl_FragColor = vec4(u_color * a * u_intensity, 1.0);
}
`;
