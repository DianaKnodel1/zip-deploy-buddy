// === Bewerbungs-Erfolgs-Modal (klassisch + Fast-Track/WhatsApp) ===
function __waFormatNumber(num){
  var d = String(num||'').replace(/[^0-9]/g,'');
  if(!d) return '';
  // simple formatting: +49 170 1234567
  if(d.length > 4) return '+' + d.slice(0,2) + ' ' + d.slice(2,5) + ' ' + d.slice(5);
  return '+' + d;
}
function showApplicationModal(opts){
  opts = opts || {};
  var isFast = !!opts.fast;
  var wa = String(opts.whatsapp||'').replace(/[^0-9]/g,'');
  var overlay = document.createElement('div');
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(2px);';
  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;color:#0f172a;max-width:460px;width:100%;border-radius:14px;padding:28px;box-shadow:0 20px 60px -10px rgba(0,0,0,.35);font-family:inherit;position:relative;';
  var close = document.createElement('button');
  close.type='button'; close.setAttribute('aria-label','Schließen');
  close.innerHTML='&times;';
  close.style.cssText='position:absolute;top:10px;right:14px;background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:#64748b;';
  close.onclick=function(){ overlay.remove(); };
  var check = document.createElement('div');
  check.style.cssText='width:46px;height:46px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;margin-bottom:14px;';
  check.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var h = document.createElement('h3');
  h.textContent = 'Vielen Dank für Ihre Bewerbung';
  h.style.cssText='margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.25;';
  var p = document.createElement('p');
  p.style.cssText='margin:0 0 18px;color:#475569;font-size:15px;line-height:1.55;';
  box.appendChild(close); box.appendChild(check); box.appendChild(h); box.appendChild(p);
  function __waCard(){
    var card = document.createElement('div');
    card.style.cssText='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;';
    var label = document.createElement('div');
    label.textContent='SCHNELLER KONTAKT';
    label.style.cssText='font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px;';
    var info = document.createElement('p');
    info.style.cssText='margin:0 0 12px;font-size:14px;color:#475569;line-height:1.5;';
    info.innerHTML='Melden Sie sich bei WhatsApp unter <strong>'+__waFormatNumber(wa)+'</strong>, um auf dem neusten Stand zu bleiben.';
    var btn = document.createElement('a');
    btn.href='https://wa.me/'+wa+'?text='+encodeURIComponent('Hallo, ich habe gerade meine Bewerbung abgeschickt.');
    btn.target='_blank'; btn.rel='noopener';
    btn.style.cssText='display:flex;align-items:center;justify-content:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:12px 16px;border-radius:8px;font-size:15px;';
    btn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24z"/></svg> WhatsApp-Chat starten';
    card.appendChild(label); card.appendChild(info); card.appendChild(btn);
    return card;
  }
  if(isFast){
    p.textContent = 'Vielen Dank für Ihre Bewerbung. Im nächsten Schritt werden Sie zum Mitarbeiter-Portal für die Registrierung weitergeleitet.';
    if(opts.redirectUrl){
      var goNow = document.createElement('button');
      goNow.type='button'; goNow.textContent='Jetzt zum Portal →';
      goNow.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;border:0;padding:12px 18px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:12px;';
      var redirInfo = document.createElement('p');
      redirInfo.style.cssText='margin:0 0 12px;font-size:13px;color:#64748b;';
      var __secs = 10;
      redirInfo.textContent = 'Automatische Weiterleitung in ' + __secs + ' Sekunden …';
      box.appendChild(goNow); box.appendChild(redirInfo);
      var __redir = function(){ window.location.href = opts.redirectUrl; };
      goNow.onclick = __redir;
      var __tick = setInterval(function(){
        __secs -= 1;
        if(__secs <= 0){ clearInterval(__tick); __redir(); return; }
        redirInfo.textContent = 'Automatische Weiterleitung in ' + __secs + ' Sekunden …';
      }, 1000);
    }
  } else {
    if(wa){
      p.textContent = 'Vielen Dank für Ihre Bewerbung. Wir haben Ihre Bewerbung erhalten und melden uns binnen 10 Tagen zurück.';
      box.appendChild(__waCard());
    } else {
      p.textContent = 'Wir haben Ihre Unterlagen erhalten und melden uns i.d.R. innerhalb von 10 Tagen per E-Mail bei Ihnen.';
    }
  }
  var closeBtn = document.createElement('button');
  closeBtn.type='button'; closeBtn.textContent='Schließen';
  closeBtn.style.cssText='background:#fff;border:1px solid #cbd5e1;color:#0f172a;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;';
  closeBtn.onclick=function(){ overlay.remove(); };
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
(function () {
  // Form submission
  var form = document.getElementById("application-form");
  var status = document.getElementById("form-status");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.className = "status";
      status.textContent = "Wird gesendet…";
      var raw = Object.fromEntries(new FormData(form).entries());
      var first = (raw.first_name || "").toString().trim();
      var last = (raw.last_name || "").toString().trim();
      var street = (raw.street || "").toString().trim();
      var msg = (raw.message || "").toString().trim();
      var data = {
        first_name: first || null,
        last_name: last || null,
        full_name: (first + " " + last).trim() || raw.full_name || "",
        email: raw.email,
        phone: raw.phone || null,
        postal_code: raw.postal_code || null,
        city: raw.city || null,
        message: [street ? "Adresse: " + street : "", msg].filter(Boolean).join("\n\n") || null,
      };
      data.domain = (window.location && window.location.hostname ? window.location.hostname : "").replace(/^www\./, "");
      data.flow_type = window.FLOW_TYPE || "classic";
      if (window.TENANT_ID) data.tenant_id = window.TENANT_ID;
      if (window.PORTAL_URL) data.portal_url = window.PORTAL_URL;
      if (window.SOURCE_SLUG) data.source_slug = window.SOURCE_SLUG;
      fetch(window.PORTAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (res) {
          form.reset();
          status.className = "status success";
          status.textContent = "Bewerbung erfolgreich gesendet.";
          var isFast = (window.FLOW_TYPE || "classic") === "fast";
          showApplicationModal({ fast: isFast, whatsapp: window.WHATSAPP_NUMBER || "", redirectUrl: (res && res.redirect_url) || "" });
        })
        .catch(function () {
          status.className = "status error";
          status.textContent = "Da ist etwas schiefgelaufen. Bitte später erneut versuchen.";
        });
    });
  }

  // FAQ accordion
  document.querySelectorAll(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var item = q.closest(".faq-item");
      if (item) item.classList.toggle("open");
    });
  });

  // Burger
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav-links");
  if (burger && nav) burger.addEventListener("click", function () { nav.classList.toggle("open"); });

  // Legal-Sektionen via Hash umschalten (funktioniert auch im iframe-Preview)
  var LEGAL_IDS = ["impressum", "datenschutz", "agb"];
  function syncLegal() {
    var h = (location.hash || "").replace("#", "");
    document.querySelectorAll(".legal").forEach(function (el) { el.classList.remove("is-open"); });
    if (LEGAL_IDS.indexOf(h) >= 0) {
      var el = document.getElementById(h);
      if (el) { el.classList.add("is-open"); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }
  }
  window.addEventListener("hashchange", syncLegal);
  syncLegal();
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (!id || id.length <= 1) return;
      var target = id.slice(1);
      if (LEGAL_IDS.indexOf(target) >= 0) return;
      var el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        document.querySelectorAll(".legal").forEach(function (s) { s.classList.remove("is-open"); });
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
        el.scrollIntoView({ behavior: "smooth" });
        if (nav) nav.classList.remove("open");
      }
    });
  });

  // Scroll-Animate
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll("[data-animate]").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll("[data-animate]").forEach(function (el) { el.classList.add("visible"); });
  }
})();

// === Floating WhatsApp-Button (sichtbar, sobald window.WHATSAPP_NUMBER gesetzt) ===
document.addEventListener('DOMContentLoaded', function(){
  var wa = String(window.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  if (!wa) return;
  if (document.getElementById('wa-float-btn')) return;
  var a = document.createElement('a');
  a.id = 'wa-float-btn';
  a.href = 'https://wa.me/' + wa;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Kontaktieren Sie uns auf WhatsApp');
  a.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:9998;display:flex;align-items:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:999px;font-size:15px;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 8px 24px rgba(34,197,94,.35);transition:transform .15s ease;';
  a.onmouseenter = function(){ a.style.transform = 'translateY(-2px)'; };
  a.onmouseleave = function(){ a.style.transform = 'translateY(0)'; };
  a.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24z"/></svg><span>Kontaktieren Sie uns auf WhatsApp</span>';
  document.body.appendChild(a);
  // Auf schmalen Screens nur Icon
  var mq = window.matchMedia('(max-width: 540px)');
  function apply(){ var span = a.querySelector('span'); if(span) span.style.display = mq.matches ? 'none' : 'inline'; }
  apply(); mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
});
