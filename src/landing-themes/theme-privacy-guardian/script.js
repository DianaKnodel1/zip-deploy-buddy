(function () {
  // Expand data-list="line1\nline2..." into <li>line</li>
  document.querySelectorAll("[data-list]").forEach(function (ul) {
    var raw = ul.getAttribute("data-list") || "";
    var lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    ul.innerHTML = lines.map(function (l) {
      // strip leading ✓/✔/- markers
      var clean = l.replace(/^[\u2713\u2714\-•·*]\s*/, "");
      return "<li>" + clean.replace(/[<>]/g, "") + "</li>";
    }).join("");
  });

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
        full_name: (first + " " + last).trim() || raw.full_name || "",
        email: raw.email,
        phone: raw.phone || null,
        postal_code: raw.postal_code || null,
        city: raw.city || null,
        message: [street ? "Adresse: " + street : "", msg].filter(Boolean).join("\n\n") || null,
      };
      data.flow_type = window.FLOW_TYPE || "classic";
      if (window.TENANT_ID) data.tenant_id = window.TENANT_ID;
      if (window.PORTAL_URL) data.portal_url = window.PORTAL_URL;
      fetch(window.PORTAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (res) {
          form.reset();
          var isFast = (window.FLOW_TYPE || "classic") === "fast";
          if (isFast) {
            status.className = "status success";
            status.textContent = "Vielen Dank für die Bewerbung. Im nächsten Schritt werden Sie zum Mitarbeiter-Portal weitergeleitet und müssen sich registrieren um fortzufahren.";
            if (res && res.redirect_url) {
              setTimeout(function () { window.location.href = res.redirect_url; }, 2500);
            }
          } else {
            status.className = "status success";
            status.textContent = "Vielen Dank, wir haben Ihre Bewerbung erhalten und melden uns i.d.R. binnen 10 Tagen bei Ihnen.";
          }
        })
        .catch(function () {
          status.className = "status error";
          status.textContent = "Da ist etwas schiefgelaufen. Bitte später erneut versuchen.";
        });
    });
  }

  // Burger
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav-links");
  if (burger && nav) burger.addEventListener("click", function () { nav.classList.toggle("open"); });

  // Legal-Sektionen via Hash umschalten
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
