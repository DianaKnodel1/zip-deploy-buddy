document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav-links');
  if (burger && nav) burger.addEventListener('click', () => nav.classList.toggle('open'));

  // Bewerbungsformular
  const form = document.getElementById('application-form');
  const status = document.getElementById('form-status');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      status.className = 'status';
      status.textContent = 'Wird gesendet…';
      const raw = Object.fromEntries(new FormData(form).entries());
      const first = (raw.first_name || '').toString().trim();
      const last = (raw.last_name || '').toString().trim();
      const street = (raw.street || '').toString().trim();
      const msg = (raw.message || '').toString().trim();
      const data = {
        full_name: (first + ' ' + last).trim() || raw.full_name || '',
        email: raw.email,
        phone: raw.phone || null,
        postal_code: raw.postal_code || null,
        city: raw.city || null,
        message: [street ? 'Adresse: ' + street : '', msg].filter(Boolean).join('\n\n') || null,
      };
      data.flow_type = window.FLOW_TYPE || 'classic';
      if (window.TENANT_ID) data.tenant_id = window.TENANT_ID;
      if (window.PORTAL_URL) data.portal_url = window.PORTAL_URL;
      fetch(window.PORTAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((res) => {
          form.reset();
          if (res && res.redirect_url) {
            status.className = 'status success';
            status.textContent = 'Danke! Sie werden weitergeleitet…';
            setTimeout(() => { window.location.href = res.redirect_url; }, 900);
          } else {
            status.className = 'status success';
            status.textContent = 'Danke! Wir melden uns innerhalb von 24 Stunden.';
          }
        })
        .catch(() => {
          status.className = 'status error';
          status.textContent = 'Da ist etwas schiefgelaufen. Bitte später erneut versuchen.';
        });
    });
  }


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
