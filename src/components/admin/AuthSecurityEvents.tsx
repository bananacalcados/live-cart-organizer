import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

const mask = (e?: string | null) => {
  if (!e) return "—";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}***@${d ?? ""}`;
};
const LABEL: Record<string, string> = {
  password_reset_requested: "Pedido de nova senha",
  login_failed: "Login falhou",
  login_ok: "Login ok",
};

/** Pedidos de nova senha e logins (últimos 100). Alerta: IP fora do Brasil ou conta parada há +60 dias. */
export function AuthSecurityEvents() {
  const { data, isFetching } = useQuery({
    queryKey: ["auth-security-events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("security_events")
        .select("id, created_at, event, ip, details")
        .in("event", ["password_reset_requested", "login_failed", "login_ok"])
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as { id: string; created_at: string; event: string; ip: string | null; details: any }[];
    },
  });
  const alerts = (data ?? []).filter((r) => r.event === "password_reset_requested" && r.details?.alert);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        Logins e pedidos de nova senha
        {alerts.length > 0 && <Badge variant="destructive">{alerts.length} alerta(s)</Badge>}
      </h2>
      <div className="overflow-x-auto border border-border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr>{["Data", "Evento", "E-mail", "IP", "País", "Observação"].map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {(data ?? []).map((r) => {
              const d = r.details || {};
              const alert = r.event === "password_reset_requested" && d.alert;
              const notes = [
                d.country && d.country !== "BR" ? "fora do Brasil" : null,
                d.stale_days > 60 ? `conta sem login há ${d.stale_days} dias` : null,
                d.account_exists && !d.last_sign_in_at && r.event === "password_reset_requested" ? "conta nunca entrou" : null,
                d.rate_limited ? "bloqueado por excesso" : null,
                r.event === "password_reset_requested" && !d.account_exists ? "e-mail não cadastrado" : null,
                d.declared_by === "browser" ? "informado pelo navegador" : null,
              ].filter(Boolean).join(" · ");
              return (
                <tr key={r.id} className={`border-t border-border ${alert ? "bg-destructive/10" : ""}`}>
                  <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  <td className="p-3">{alert && <Badge variant="destructive" className="mr-2">Alerta</Badge>}{LABEL[r.event] ?? r.event}</td>
                  <td className="p-3">{mask(d.email)}</td>
                  <td className="p-3 whitespace-nowrap">{r.ip || "—"}</td>
                  <td className="p-3">{d.country || "?"}</td>
                  <td className="p-3 text-muted-foreground">{notes || "—"}</td>
                </tr>
              );
            })}
            {!data?.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{isFetching ? "Carregando…" : "Nenhum registro."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
