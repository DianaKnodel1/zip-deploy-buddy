// theme-02 / theme-03 / theme-04 share the same form-submission contract
(function () {
  var form = document.getElementById("application-form");
  var status = document.getElementById("form-status");
  if (!form) return;
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
          status.textContent = "Danke! Du wirst zur Registrierung weitergeleitet…";
          setTimeout(function () { window.location.href = res.redirect_url; }, 900);
        } else if ((window.FLOW_TYPE || "classic") === "fast" && window.PORTAL_URL) {
          status.className = "status success";
          status.textContent = "Danke! Du wirst zur Registrierung weitergeleitet…";
          setTimeout(function () { window.location.href = window.PORTAL_URL + "/register?email=" + encodeURIComponent(data.email) + "&fast=1"; }, 900);
        } else {
          status.className = "status success";
          status.textContent = "Danke! Wir melden uns in Kürze per E-Mail.";
        }
      })
      .catch(function () {
        status.className = "status error";
        status.textContent = "Da ist etwas schiefgelaufen. Bitte später erneut versuchen.";
      });
  });

  // FAQ accordion
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    if (q) q.addEventListener("click", function () { item.classList.toggle("open"); });
  });

  // Mobile menu toggle (if present)
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav-links");
  if (burger && nav) burger.addEventListener("click", function () { nav.classList.toggle("open"); });
})();
