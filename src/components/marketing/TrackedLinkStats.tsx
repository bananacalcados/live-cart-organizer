import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Pessoas que receberam o link personalizado e quantas clicaram (1 chamada ao abrir). */
export function TrackedLinkStats({ slug }: { slug: string }) {
  const [s, setS] = useState<{ sent: number; clicked: number } | null>(null);
  useEffect(() => {
    let off = false;
    (supabase as any).rpc("tracked_link_stats", { p_slug: slug }).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : null;
      if (!off && r && Number(r.sent) > 0) setS({ sent: Number(r.sent), clicked: Number(r.clicked) });
    });
    return () => { off = true; };
  }, [slug]);
  if (!s) return null;
  return (
    <span className="block">
      {s.sent} receberam link personalizado · {s.clicked} pessoas identificadas clicaram
    </span>
  );
}
