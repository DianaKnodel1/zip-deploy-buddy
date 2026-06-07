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
      var data = Object.fromEntries(new FormData(form).entries());
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
          if (res && res.redirect_url) {
            status.className = "status success";
            status.textContent = "Danke! Sie werden weitergeleitet…";
            setTimeout(function () { window.location.href = res.redirect_url; }, 900);
          } else {
            status.className = "status success";
            status.textContent = "Danke! Wir melden uns innerhalb von 24h.";
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
