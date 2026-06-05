import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { updateLastSeen } from "@/lib/presence.functions";

/**
 * Modul-globaler Store für die Menge an aktuell online User-IDs.
 * Wird vom Broadcast-Channel befüllt und von useOnlineUsers gelesen.
 * So vermeiden wir, denselben Realtime-Channel zweimal zu abonnieren
 * (Supabase verbietet .on() nach subscribe() auf derselben Instanz).
 */
let currentOnline: Set<string> = new Set();
const listeners = new Set<(s: Set<string>) => void>();

function setOnlineGlobal(next: Set<string>) {
  currentOnline = next;
  listeners.forEach((l) => l(next));
}

/**
 * Mountet einen globalen Realtime-Presence-Channel und einen DB-Heartbeat
 * (profiles.last_seen_at). Einmal pro App-Session im Root mounten.
 */
export function usePresenceBroadcast() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel("online-users", {
      config: { presence: { key: user.id } },
    });

    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        if (key.startsWith("viewer-")) continue;
        ids.add(key);
        for (const meta of state[key] ?? []) {
          if (meta?.user_id) ids.add(meta.user_id);
        }
      }
      setOnlineGlobal(ids);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          try {
            await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
          } catch {}
        }
      });

    // DB-Heartbeat (last_seen_at) alle 60s
    const beat = async () => {
      try {
        await updateLastSeen({ data: undefined as any });
      } catch {}
    };
    beat();
    const iv = window.setInterval(beat, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisibility);
      try { channel.untrack(); } catch {}
      supabase.removeChannel(channel);
      setOnlineGlobal(new Set());
    };
  }, [user?.id]);
}

/**
 * Hook für Admin-Views: liefert ein Set mit aktuell online User-IDs.
 * Liest aus dem geteilten Store, den usePresenceBroadcast befüllt.
 */
export function useOnlineUsers(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(currentOnline);

  useEffect(() => {
    const l = (s: Set<string>) => setOnline(s);
    listeners.add(l);
    setOnline(currentOnline);
    return () => { listeners.delete(l); };
  }, []);

  return online;
}
