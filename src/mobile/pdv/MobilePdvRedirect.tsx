import { ReactNode, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isMobileDevice, readEnv } from "@/mobile/inventory/redirect";
import { dismissPdvInvite, parsePdvRedirectMode, readPdvInviteDismissed, readPdvPref, setPdvDesktopPreference, shouldAutoOpenMobilePdv, shouldShowPdvInvite } from "./redirect";

/** app_settings.pos_mobile_redirect: 'off' (padrão) nada, 'invite' faixa, 'auto' desvia. Computador não consulta nada. */
export function MobilePdvRedirect({ children }: { children: ReactNode }) {
  const env = readEnv();
  const mobile = isMobileDevice(env);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readPdvInviteDismissed);
  const { data: mode } = useQuery({
    queryKey: ["pos_mobile_redirect"], enabled: mobile, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "pos_mobile_redirect").maybeSingle();
      return parsePdvRedirectMode(data?.value);
    },
  });
  if (!mobile || !mode) return <>{children}</>;
  if (shouldAutoOpenMobilePdv({ ...env, pref: readPdvPref() }, mode)) return <Navigate to="/m/pdv" replace />;
  return (
    <>
      {shouldShowPdvInvite(env, mode, dismissed) && (
        <div className="sticky top-0 z-50 flex items-center gap-2 border-b bg-primary p-3 text-primary-foreground">
          <Smartphone className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1 text-sm font-semibold">Experimente o PDV para celular</p>
          <Button variant="secondary" className="h-12 px-5 text-base font-bold" onClick={() => { setPdvDesktopPreference(false); navigate("/m/pdv"); }}>Abrir</Button>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-primary-foreground" aria-label="Dispensar convite"
            onClick={() => { dismissPdvInvite(); setDismissed(Date.now()); }}><X className="h-5 w-5" /></Button>
        </div>
      )}
      {children}
    </>
  );
}
