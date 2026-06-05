import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { updateLastSeen } from "@/lib/presence.functions";

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

    channel.subscribe(async (status) => {
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
    };
  }, [user?.id]);
}

/**
 * Hook für Admin-Views: liefert ein Set mit aktuell online User-IDs.
 */
export function useOnlineUsers(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    const viewerKey = "viewer-" + Math.random().toString(36).slice(2);
    // Eigener Channel-Name pro Viewer-Instanz, damit wir nicht den bereits
    // subscribten Broadcast-Channel "online-users" wiederverwenden
    // (Supabase verbietet .on() nach subscribe() auf derselben Instanz).
    const channel = supabase.channel(`online-users-watch-${viewerKey}`, {
      config: { presence: { key: viewerKey } },
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
      setOnline(ids);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          try { await channel.track({ viewer: true }); } catch {}
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  return online;
}
