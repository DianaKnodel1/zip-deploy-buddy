# SMTP Auto-Pause pro Tenant

## Grundprinzip

Jeder Tenant hat seine eigene Domain + sein eigenes SMTP. Wenn Tenant A's SMTP fehlschlägt, wird **nur** Tenant A pausiert. Tenant B, C, D laufen normal weiter. Kein Auto-Resume — du reaktivierst manuell im Admin, sobald du Domain/SMTP gewechselt hast.

Das ergänzt den bereits existierenden `domain-health-cron` (der bei kompletter Domain-Down-Phase pausiert) um die SMTP-Auth-Ebene: Domain antwortet, aber SMTP-Login tot → ebenfalls pausieren.

## Was passiert konkret

### 1. Vor jedem Mail-Versand: `transporter.verify()`

Eingefügt in alle vier Edge Functions, die SMTP nutzen:
- `send-signup-confirmation`
- `resend-signup-confirmation`
- `send-password-reset`
- `send-reminders`

Ablauf pro Send:
1. Tenant laden → SMTP-Felder vorhanden? Wenn nicht: Skip.
2. **Wenn `tenant.emails_paused === true`**: sofort skip, kein Verify, kein Send. (Schützt vor "Wake-up-Spam" nach Restore.)
3. `transporter.verify()` mit 8s Timeout.
   - **Erfolg** → `sendMail()` wie bisher.
   - **Fehler** (Auth/Connection/TLS) → Tenant pausieren + `activity_log` + `email_logs` mit `status='failed'`. Kein Send.

### 2. Smart-Pause-Logik (gegen False Positives)

Ein einzelner `verify()`-Fehler kann auch ein Netzwerk-Hickup sein. Deshalb:
- Neue Tabelle `tenant_smtp_health` mit Counter `consecutive_fails`.
- **Pause erst nach 3 aufeinander folgenden Fails innerhalb 15 Min** — danach: `emails_paused = true`, `emails_paused_by = 'auto:smtp_verify'`, `emails_paused_reason = 'SMTP-Verify schlug 3x fehl: <error>'`.
- Erster erfolgreicher `verify()` setzt den Counter zurück.

### 3. Manuelles Resume (kein Auto-Resume)

Genau wie beim Domain-Down-Cron: Du gehst in `/admin/tenants`, siehst Badge "SMTP pausiert" mit Grund, korrigierst SMTP-Daten und klickst "Versand fortsetzen". Setzt `emails_paused = false` und löscht den Counter.

### 4. Admin-UI in `/admin/tenants`

- Pro Tenant-Zeile: Badge "✅ SMTP ok" / "⏸ Pausiert (Grund)" / "⚠ 2/3 Fails"
- Button "SMTP jetzt prüfen" → ruft neue Server-Function, die `verify()` ausführt und Status anzeigt
- Button "Versand fortsetzen" (nur sichtbar wenn pausiert)

## Was sich an bestehenden Sachen NICHT ändert

- Reminder/Recovery-Cron läuft weiter wie gehabt — er respektiert `emails_paused` schon (für andere Tenants).
- `domain-health-cron` bleibt unverändert (pingt Domain, pausiert wenn alle Domains down).
- Welcome- und Password-Reset-Mails laufen weiter, **außer** bei pausiertem Tenant — dann werfen sie einen klaren Fehler ("E-Mail-Versand für diesen Mandanten ist pausiert. Bitte Admin kontaktieren.") an die UI.

## Was passiert in deinem aktuellen digital-dgigmbh-Fall

Sobald deployed:
1. Nächste Mail an digital-dgigmbh läuft in `verify()`-Fail (SMTP-Passwort tot).
2. 3 Versuche → Tenant wird auto-pausiert.
3. Du siehst in `/admin/tenants` rotes Badge mit Grund.
4. Du korrigierst SMTP-Daten (neues Passwort oder Hoster-Wechsel) → klickst "Versand fortsetzen".
5. Andere Tenants merken nichts davon.

## Technische Änderungen

### Neue Migration
`supabase/manual-migrations/20260608110000_tenant_smtp_health.sql`
```sql
CREATE TABLE public.tenant_smtp_health (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  consecutive_fails int NOT NULL DEFAULT 0,
  last_fail_at timestamptz,
  last_fail_error text,
  last_verify_at timestamptz,
  last_verify_ok boolean
);
GRANT SELECT ON public.tenant_smtp_health TO authenticated;
GRANT ALL ON public.tenant_smtp_health TO service_role;
ALTER TABLE public.tenant_smtp_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read smtp_health" ON public.tenant_smtp_health
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
```

### Shared Helper (in jede Edge Function inline kopiert — Deno hat kein Cross-Import-Sharing)
```ts
async function verifyOrPause(tenant, supabase, transporter): Promise<{ok: boolean, reason?: string}> {
  if (tenant.emails_paused) return {ok: false, reason: 'paused'};
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('verify timeout 8s')), 8000))
    ]);
    await supabase.from('tenant_smtp_health').upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true
    });
    return {ok: true};
  } catch (e) {
    const {data: h} = await supabase.from('tenant_smtp_health')
      .select('consecutive_fails').eq('tenant_id', tenant.id).maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;
    await supabase.from('tenant_smtp_health').upsert({
      tenant_id: tenant.id, consecutive_fails: fails,
      last_fail_at: new Date().toISOString(), last_fail_error: String(e.message),
      last_verify_at: new Date().toISOString(), last_verify_ok: false
    });
    if (fails >= 3) {
      await supabase.from('tenants').update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${e.message}`,
        emails_paused_by: 'auto:smtp_verify',
      }).eq('id', tenant.id);
      await supabase.from('activity_log').insert({
        action: 'emails_auto_pausiert', entity_type: 'tenant', entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${e.message}`
      });
    }
    return {ok: false, reason: e.message};
  }
}
```

### Geänderte Dateien
- `supabase/functions/send-signup-confirmation/index.ts` — Verify vor Send
- `supabase/functions/resend-signup-confirmation/index.ts` — Verify vor Send
- `supabase/functions/send-password-reset/index.ts` — Verify vor Send
- `supabase/functions/send-reminders/index.ts` — Verify pro Tenant einmal (vor Batch)
- `src/routes/admin.tenants.tsx` — Badge + Resume-Button
- `src/lib/admin-tenants.functions.ts` (neu oder bestehend) — `verifyTenantSmtp`, `resumeTenantEmails` Server-Functions

## Frage an dich

**Schwellenwert: 3 Fails (mein Vorschlag) oder direkt nach 1 Fail pausieren?**
- 3 Fails: Robuster gegen Netzwerk-Hickups, ~1 Min Verzögerung bei echtem Ausfall.
- 1 Fail: Sofortige Pause, aber gelegentlich falscher Alarm bei Provider-Timeouts.

Ich empfehle 3. Sag Bescheid, dann implementiere ich alles in einem Rutsch.
