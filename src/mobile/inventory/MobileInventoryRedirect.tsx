import { ReactNode, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { dismissInvite, isMobileDevice, parseRedirectMode, readEnv, readInviteDismissed, setDesktopPreference, shouldShowInvite, shouldUseMobileInventory } from "./redirect";

/** app_settings.inventory_mobile_redirect: 'invite' (padrão) mostra faixa, 'auto' desvia, 'off' nada. Computador não consulta nada. */
export function MobileInventoryRedirect({ children }: { children: ReactNode }) {
  const env = readEnv();
  const mobile = isMobileDevice(env);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readInviteDismissed);
  const { data: mode, isLoading } = useQuery({
    queryKey: ["inventory_mobile_redirect"], enabled: mobile, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "inventory_mobile_redirect").maybeSingle();
      return parseRedirectMode(data?.value);
    },
  });
  if (!mobile || isLoading || !mode) return <>{children}</>;
  if (shouldUseMobileInventory(env, mode)) return <Navigate to="/m/estoque" replace />;
  const invite = shouldShowInvite(env, mode, dismissed);
  return (
    <>
      {invite && (
        <div className="sticky top-0 z-50 flex items-center gap-2 border-b bg-primary p-3 text-primary-foreground">
          <Smartphone className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1 text-sm font-semibold">Experimente o Estoque para celular</p>
          <Button variant="secondary" className="h-12 px-5 text-base font-bold" onClick={() => { setDesktopPreference(false); navigate("/m/estoque"); }}>Abrir</Button>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-primary-foreground" aria-label="Dispensar convite"
            onClick={() => { dismissInvite(); setDismissed(Date.now()); }}><X className="h-5 w-5" /></Button>
        </div>
      )}
      {children}
    </>
  );
}
