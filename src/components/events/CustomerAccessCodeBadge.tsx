import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";

/**
 * Mostra o código de acesso PERMANENTE do cliente (OTP fixo) direto no card do pedido,
 * para a equipe passar ao cliente quando ele pedir.
 */
export function CustomerAccessCodeBadge({ phone }: { phone?: string | null }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 10) return;
    (async () => {
      const { data } = await supabase.rpc("get_or_create_customer_access_code" as any, {
        _phone: digits,
      } as any);
      if (!cancelled && data) setCode(String(data));
    })();
    return () => { cancelled = true; };
  }, [phone]);

  if (!code) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code);
        toast.success("Código copiado!");
      }}
      className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
      title="Código de acesso fixo do cliente (área de membros / roleta)"
    >
      <KeyRound className="h-3 w-3" />
      <span className="font-mono tracking-widest">{code}</span>
      <Copy className="h-3 w-3 opacity-60" />
    </button>
  );
}
