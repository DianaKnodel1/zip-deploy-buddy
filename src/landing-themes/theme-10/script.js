document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav-links');
  if (burger && nav) burger.addEventListener('click', () => nav.classList.toggle('open'));

  const LEGAL_IDS = ['impressum', 'datenschutz', 'agb'];
  function syncLegal() {
    const h = (location.hash || '').replace('#', '');
    document.querySelectorAll('.legal').forEach(el => el.classList.remove('is-open'));
    if (LEGAL_IDS.includes(h)) {
      const el = document.getElementById(h);
      if (el) { el.classList.add('is-open'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  }
  window.addEventListener('hashchange', syncLegal);
  syncLegal();

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id.length <= 1) return;
      const target = id.slice(1);
      if (LEGAL_IDS.includes(target)) return; // hash-Wechsel zulassen → syncLegal
      const el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        // alle legal-Sektionen ausblenden, wenn auf Hauptbereich gesprungen wird
        document.querySelectorAll('.legal').forEach(s => s.classList.remove('is-open'));
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        el.scrollIntoView({ behavior: 'smooth' });
        nav?.classList.remove('open');
      }
    });
  });

  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-q')?.addEventListener('click', () => {
      document.querySelectorAll('.faq-item.open').forEach(o => { if (o !== item) o.classList.remove('open'); });
      item.classList.toggle('open');
    });
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-animate]').forEach(el => io.observe(el));
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
});
