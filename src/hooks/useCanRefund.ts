import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Permissão de estorno: admin ou módulo "estornos" em user_module_permissions.
 * Esconder o botão é só conveniência — a edge function mp-refund valida de novo no servidor.
 */
export function useCanRefund(): boolean {
  const [can, setCan] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) return;
        const { data } = await supabase.rpc("has_module_access" as any, { _user_id: uid, _module: "estornos" } as any);
        if (active) setCan(!!data);
      } catch {
        /* sem permissão */
      }
    })();
    return () => { active = false; };
  }, []);

  return can;
}
