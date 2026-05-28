import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin(enabled: boolean = true) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsAdmin(false);
      setReady(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) { setReady(true); } return; }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (cancelled) return;
      const roles = (data || []).map((r: any) => r.role);
      setIsAdmin(roles.includes("admin"));
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return { isAdmin, ready };
}
