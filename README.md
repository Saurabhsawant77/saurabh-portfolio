# Saurabh Sawant — Scroll-Driven Space Portfolio

A personal portfolio built as a cinematic scroll journey: it opens close to Earth, pulls back past the Moon, reveals a stylised solar system, and moves through profile, experience, skills, projects, education and contact.

Built with **vanilla HTML, CSS and JavaScript only**: no frameworks, no animation or 3D libraries, no build step. The 3D scene is native WebGL 1, written from scratch.

## Run locally

ES modules need an HTTP server (opening `index.html` from disk won't work).

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works, e.g. `npx serve .`.

Append `?debug` to the URL to turn off camera smoothing. Use it for screenshots or automated checks; it changes nothing else.

## File structure

```
index.html                 All content as semantic HTML (works without JS)
css/
  reset.css                Minimal modern reset
  styles.css               Design tokens, layout, components
  responsive.css           Tablet / phone layouts, reduced motion, print
js/
  main.js                  Entry: content enhancements, render loop, quality tiers
  scroll-controller.js     Scroll position → camera state (keyframes per section)
  space-scene.js           WebGL renderer: Earth, Moon, Sun, planets, orbits, stars, labels
  shaders.js               GLSL sources (texture bake, Earth, planets, Sun, rings, points, glows)
  earth-data.js            Simplified coastline polygons (lon/lat) for the Earth texture
  gl-math.js               Tiny matrix helpers, easing, seeded PRNG
  navigation.js            Mobile menu, active-section highlighting, header state
  skills-constellation.js  Builds a star chart for each skill group from its HTML list
  fallback-scene.js        Canvas 2D + CSS Earth used if WebGL is unavailable or lost
assets/
  icons/favicon.svg
  resume/CV_Saurabh_Sawant.pdf   Downloadable résumé
```

## How the journey works

- **One fixed stage, normal content.** A fixed full-screen `<canvas>` sits behind ordinary `<section>` elements. Content scrolls naturally, so anchor links, browser history, keyboard navigation and screen readers all behave normally. The canvas is `aria-hidden` and has `pointer-events: none`.
- **A real 3D scene, artistically scaled.** The Sun is at the origin and the planets are on circular orbits. Earth is fixed at 30 units out, and the Moon orbits it. Sizes and distances are chosen for composition, not physical accuracy.
- **Camera keyframes per section.** Each `<section data-scene="…">` adds two keyframes, one as it arrives and one as it leaves. `scroll-controller.js` interpolates between them:
  - The camera's focus point slides from Earth to the Sun.
  - Distance is interpolated on a **log scale**, so the Earth shrinks continuously instead of collapsing at the end.
  - Within a section the camera drifts gently; between sections it eases in and out.
  - `shiftX` / `shiftY` shift the projection sideways so planets sit beside the text, not under it.
- **Reversible by construction.** The camera state is a pure function of scroll position, with light damping, so scrolling up replays the journey backwards.
- **Procedural Earth.** At start-up, `earth-data.js` polygons are drawn into a land mask with Canvas 2D. One GPU pass then bakes two equirectangular textures:
  - **Colour:** coastlines roughened with noise, vegetation by latitude, hand-placed arid regions, ice caps, shallow seas, plus an ocean mask for specular highlights.
  - **Clouds and city lights.**

  The Earth shader adds day/night lighting, moving clouds with shadows, ocean glints, night-side city lights, an atmospheric rim and a glow billboard, plus a pulsing marker on Navi Mumbai. Noise is sampled in 3D on the sphere, so there is no seam or polar pinching.
- **Mission labels** are drawn on a 2D overlay canvas by projecting each body with the same view/projection matrices as the WebGL scene.

## Accessibility

- Semantic landmarks and headings, a skip link, visible `:focus-visible` rings, and keyboard-operable navigation (Escape closes the mobile menu).
- All essential information is plain HTML. The skill constellations and architecture diagrams are decorative or labelled with `role="img"` plus a title and description, and every skill also appears in a readable list.
- `prefers-reduced-motion`: camera moves are replaced by one static composition per section with a short cross-fade. Planet rotation, twinkle, CSS animations, SVG orbit animations and smooth scrolling are all turned off.
- Without JavaScript, all content is visible; only the decorative scene is missing.

## Performance

- **Quality tiers** (`main.js`) set pixel ratio, star/dust counts, sphere detail and Earth texture size (4096 / 2048 / 1024) based on viewport, `deviceMemory`, `hardwareConcurrency` and Save-Data.
- **Adaptive resolution:** if frames run slow after start-up, the canvas pixel ratio drops step by step. Throttled background frames are ignored.
- **Pausing:** the render loop stops while the tab is hidden.
- **Non-blocking start:** the WebGL scene is created after first paint, so text renders immediately, and the stage fades in once ready.
- **Cheap scrolling:** only transforms and opacity are animated in the DOM. There are no layout reads in the scroll loop; section offsets are cached and re-measured on resize.
- **WebGL context loss:** handled by switching to the 2D fallback, and back again when the context is restored.

## Content notes

- **Résumé:** `assets/resume/CV_Saurabh_Sawant.pdf`, linked from the hero and contact sections. To replace it, overwrite the file, or change the path in `<meta name="resume-pdf">` in `index.html`. If that meta tag is left empty, the buttons fall back to a mailto "Request Résumé" link.
- **Mini JIRA:** there is no GitHub link because the repository URL hasn't been confirmed. Add a link in the project panel once it is available.
- **Skills:** brighter stars and bold names mark technologies that appear in the experience or projects on the page. This does not rate expertise.

## Assets and third-party sources

| Asset | Source | Notes |
| --- | --- | --- |
| Earth, planets, Sun, stars | Generated in code (`shaders.js`, `earth-data.js`) | No image files. Coastlines hand-traced at low resolution. |
| Fonts | [Manrope](https://fonts.google.com/specimen/Manrope) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) via Google Fonts | SIL Open Font License. System-font fallbacks are defined, so the site works offline. |
| Favicon, diagrams, icons | Inline SVG written for this project | — |

**Optional photographic Earth:** add `data-earth-texture="assets/textures/earth-day.jpg"` to `#scene-canvas` and supply an equirectangular day map, for example NASA's *Blue Marble*, which is public domain. It replaces the procedural colour map; clouds and lighting still apply. Keep the image to about 2048×1024 and well compressed.

## Deployment

The site is static, so any static host works:

- **GitHub Pages:** push the folder to a repository, then Settings → Pages → deploy from the branch root.
- **Netlify / Vercel / Cloudflare Pages:** create a project from the repo with no build command and the repository root as the output directory.

All paths are relative, so the site also works from a sub-path (e.g. `username.github.io/portfolio/`).

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). WebGL 1 is used for the widest coverage; browsers without it get the 2D fallback.
