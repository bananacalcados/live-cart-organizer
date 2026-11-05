import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

const PROVIDERS = [
  { key: "mercadopago", label: "Mercado Pago", signs: true },
  { key: "pagarme", label: "Pagar.me", signs: true },
  { key: "appmax", label: "Appmax", signs: false },
];

/** Estado das duas travas de pagamento por gateway: valor/referência e assinatura. */
export function WebhookStrictStatus() {
  const { data } = useQuery({
    queryKey: ["webhook-strict-status"],
    queryFn: async () => {
      const [{ data: settings }, { data: sig }] = await Promise.all([
        supabase.from("app_settings").select("key, value").in("key", ["webhook_strict_amount", "webhook_strict_signature"]),
        supabase.from("webhook_signature_state").select("provider, consecutive_valid, total_invalid, enforced, enforced_at, last_invalid_at"),
      ]);
      return { settings: settings || [], sig: sig || [] };
    },
  });
  const amountOn = data?.settings.some((s: any) => s.key === "webhook_strict_amount" && (s.value === true || s.value === "true"));

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="font-semibold">Travas dos avisos de pagamento</h3>
      <div className="grid gap-2">
        {PROVIDERS.map((p) => {
          const s: any = data?.sig.find((x: any) => x.provider === p.key);
          return (
            <div key={p.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-28 font-medium">{p.label}</span>
              <Badge variant={amountOn ? "default" : "secondary"}>Valor e referência: {amountOn ? "ligado" : "só anotando"}</Badge>
              {!p.signs ? (
                <Badge variant="outline">Assinatura: não enviada pelo gateway</Badge>
              ) : s?.enforced ? (
                <Badge variant="default">Assinatura: bloqueando inválidas</Badge>
              ) : (
                <Badge variant="secondary">Assinatura: observando ({s?.consecutive_valid ?? 0}/20 válidas seguidas)</Badge>
              )}
              {p.signs && s?.last_invalid_at && (
                <Badge variant="destructive">Última inválida: {new Date(s.last_invalid_at).toLocaleString("pt-BR")}</Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
