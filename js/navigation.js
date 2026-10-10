/**
 * Primary navigation: mobile menu, active-section highlighting and the
 * header's scrolled state. Anchor scrolling itself is native (CSS
 * scroll-behavior), so browser history and back/forward keep working.
 */

export function initNavigation() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  const links = [...document.querySelectorAll('[data-nav-link]')];

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    header.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 760px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });

  // Highlight the link of the section crossing the middle of the viewport.
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = byId.get(entry.target.id);
        links.forEach((a) => a.removeAttribute('aria-current'));
        if (link) link.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-50% 0px -50% 0px' }
  );
  document.querySelectorAll('main > section[id]').forEach((s) => observer.observe(s));

  let scrolled = null;
  return {
    update(scrollY) {
      const next = scrollY > 24;
      if (next !== scrolled) {
        scrolled = next;
        header.classList.toggle('is-scrolled', next);
      }
    },
  };
}
