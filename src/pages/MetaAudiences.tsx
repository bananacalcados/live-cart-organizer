import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Def = {
  id: string; name: string; description: string | null; kind: string; audience_id: string | null;
  frozen: boolean; enabled: boolean; initial_mode: string; initial_load_done: boolean; initial_load_not_before: string | null;
  last_sync_at: string | null; last_status: string | null; last_error: string | null;
  erp_count: number | null; invalid_count: number | null; duplicate_count: number | null;
  added_last: number | null; removed_last: number | null; meta_approx_lower: number | null; meta_approx_upper: number | null;
};
type TokenInfo = { type?: string; valid?: boolean; expires_at?: string | null; ads_management?: boolean };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const n = (v: number | null | undefined) => (v == null || v < 0 ? "—" : v.toLocaleString("pt-BR"));

export default function MetaAudiences() {
  const navigate = useNavigate();
  const [defs, setDefs] = useState<Def[]>([]);
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("meta_audience_definitions")
      .select("id,name,description,kind,audience_id,frozen,enabled,initial_mode,initial_load_done,initial_load_not_before,last_sync_at,last_status,last_error,erp_count,invalid_count,duplicate_count,added_last,removed_last,meta_approx_lower,meta_approx_upper")
      .order("kind").order("name");
    setDefs((data as Def[]) || []);
  }, []);

  useEffect(() => {
    load();
    supabase.functions.invoke("meta-audience-sync", { body: { action: "status" } }).then(({ data }) => {
      if (data?.token) setToken(data.token);
      load();
    });
  }, [load]);

  const syncNow = async (id?: string) => {
    setBusy(id || "all");
    const { data, error } = await supabase.functions.invoke("meta-audience-sync", { body: { action: "run", definition_id: id } });
    setBusy(null);
    if (error) toast.error("Falha ao sincronizar");
    else toast.success("Sincronização concluída", { description: Object.keys(data?.results || {}).length + " público(s)" });
    load();
  };

  const daysLeft = token?.expires_at ? Math.round((new Date(token.expires_at).getTime() - Date.now()) / 864e5) : null;

  return (
    <div className="container mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/marketing")}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-semibold">Públicos Meta</h1>
        <Button className="ml-auto gap-2" size="sm" disabled={!!busy} onClick={() => syncNow()}>
          <RefreshCw className={`h-4 w-4 ${busy === "all" ? "animate-spin" : ""}`} />Sincronizar agora
        </Button>
      </div>

      {token && (
        <Alert variant={token.valid && token.ads_management ? "default" : "destructive"}>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Acesso à Meta: {token.valid ? "válido" : "inválido"} · {token.type === "SYSTEM_USER" ? "usuário de sistema" : "usuário pessoal"}</AlertTitle>
          <AlertDescription>
            Vence em {token.expires_at ? new Date(token.expires_at).toLocaleDateString("pt-BR") : "nunca"}{daysLeft != null ? ` (${daysLeft} dias)` : ""}.
            {" "}{token.ads_management ? "Pode atualizar públicos." : "Sem permissão para atualizar públicos."}
            {token.type !== "SYSTEM_USER" && " Recomendado: criar um usuário de sistema no Business Manager com acesso à conta de anúncios, para não depender de uma pessoa."}
          </AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">Rodadas automáticas às 03:00 e, em dia de live, também às 10:00 e 12:00. A Meta mostra só quem ela conseguiu casar.</p>

      <div className="grid gap-3 md:grid-cols-2">
        {defs.map((d) => {
          const waiting = d.initial_mode === "replace" && !d.initial_load_done;
          return (
            <Card key={d.id} className={d.frozen ? "opacity-70" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {d.name}
                  {d.frozen && <Badge variant="secondary">Congelado</Badge>}
                  {!d.frozen && waiting && <Badge variant="outline">1ª carga em {d.initial_load_not_before ? new Date(d.initial_load_not_before).toLocaleDateString("pt-BR") : "—"}</Badge>}
                  {d.last_status === "ok" && <Badge>OK</Badge>}
                  {(d.last_status === "erro" || d.last_status === "bloqueado") && <Badge variant="destructive">{d.last_status === "erro" ? "Erro" : "Bloqueado"}</Badge>}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{d.description}</p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Pessoas no ERP</span><span>{n(d.erp_count)}</span>
                  <span className="text-muted-foreground">Na Meta (aprox.)</span><span>{n(d.meta_approx_lower)}{d.meta_approx_upper && d.meta_approx_upper > 0 ? ` – ${n(d.meta_approx_upper)}` : ""}</span>
                  <span className="text-muted-foreground">Sem telefone/e-mail válido</span><span>{n(d.invalid_count)}</span>
                  <span className="text-muted-foreground">Repetidos</span><span>{n(d.duplicate_count)}</span>
                  <span className="text-muted-foreground">Última rodada</span><span>{fmt(d.last_sync_at)}</span>
                  <span className="text-muted-foreground">Entraram / saíram</span><span>{n(d.added_last)} / {n(d.removed_last)}</span>
                </div>
                {d.last_error && <p className="text-xs text-destructive">{d.last_error}</p>}
                {!d.frozen && d.audience_id && (
                  <Button variant="outline" size="sm" className="mt-2" disabled={!!busy || waiting} onClick={() => syncNow(d.id)}>
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy === d.id ? "animate-spin" : ""}`} />Sincronizar este
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
