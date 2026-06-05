document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav-links');
  if (burger && nav) burger.addEventListener('click', () => nav.classList.toggle('open'));
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id && id.length > 1) {
        const el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); nav?.classList.remove('open'); }
      }
    });
  });
  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-q')?.addEventListener('click', () => item.classList.toggle('open'));
  });
  // Animated counter
  const counters = document.querySelectorAll('[data-count]');
  const animate = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const dur = 1500; const start = performance.now();
    const step = (t) => {
      const p = Math.min((t - start) / dur, 1);
      el.textContent = Math.floor(target * (0.2 + 0.8 * p)).toLocaleString('de-DE');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); if (e.target.dataset.count) animate(e.target); io.unobserve(e.target); }});
  }, { threshold: 0.2 });
  document.querySelectorAll('[data-animate],[data-count]').forEach(el => io.observe(el));
});
