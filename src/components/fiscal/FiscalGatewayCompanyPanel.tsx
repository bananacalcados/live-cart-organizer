import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save, Settings2 } from "lucide-react";
import { SelectCompanyDialog } from "./SelectCompanyDialog";
import { extractEdgeError } from "@/lib/edgeFunctionError";

interface Company {
  id: string;
  legal_name: string;
  cnpj: string;
  is_active?: boolean;
}
interface MapRow {
  id: string;
  gateway: string;
  company_id: string;
  is_active: boolean;
}
interface PendingRow {
  id: string;
  source_type: "pos_sale" | "order";
  source_id: string;
  reason: string;
  gateways: string[];
  company_ids: string[];
  created_at: string;
}

const GATEWAY_LABEL: Record<string, string> = {
  pagarme: "Pagar.me",
  rinne: "Rinne / AustPay",
  austpay: "AustPay / Rinne",
  mercadopago: "Mercado Pago",
  appmax: "Appmax",
  vindi: "Vindi",
};
const gatewayLabel = (gateway: string) => GATEWAY_LABEL[gateway] || gateway;
const cnpj = (value?: string) => {
  const d = String(value || "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : value || "—";
};

export function FiscalGatewayCompanyPanel({ companies }: { companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"config" | "pendings">("config");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [defaultCompanyId, setDefaultCompanyId] = useState("");
  const [rows, setRows] = useState<MapRow[]>([]);
  const [original, setOriginal] = useState("");
  const [pendings, setPendings] = useState<PendingRow[]>([]);
  const [saleTypes, setSaleTypes] = useState<Record<string, string>>({});
  const [manualPending, setManualPending] = useState<PendingRow | null>(null);
  const [emitting, setEmitting] = useState(false);

  const activeCompanies = useMemo(() => companies.filter((c) => c.is_active !== false), [companies]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const snapshot = JSON.stringify({ enabled, defaultCompanyId, rows: rows.map((r) => [r.id, r.company_id, r.is_active]) });

  const loadConfig = async () => {
    setLoading(true);
    const [configRes, mapRes] = await Promise.all([
      supabase.from("fiscal_gateway_company_config").select("emit_by_gateway, default_company_id").eq("id", true).single(),
      supabase.from("fiscal_gateway_company_map").select("id, gateway, company_id, is_active").order("gateway"),
    ]);
    if (configRes.error || mapRes.error) {
      toast.error(configRes.error?.message || mapRes.error?.message || "Erro ao carregar configuração");
    } else {
      setEnabled(!!configRes.data.emit_by_gateway);
      setDefaultCompanyId(configRes.data.default_company_id);
      setRows((mapRes.data || []) as MapRow[]);
      setOriginal(JSON.stringify({
        enabled: !!configRes.data.emit_by_gateway,
        defaultCompanyId: configRes.data.default_company_id,
        rows: ((mapRes.data || []) as MapRow[]).map((r) => [r.id, r.company_id, r.is_active]),
      }));
    }
    setLoading(false);
  };

  const loadPendings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("fiscal_emission_pendings")
      .select("id, source_type, source_id, reason, gateways, company_ids, created_at")
      .eq("status", "open").order("created_at", { ascending: false }).limit(100);
    if (error) toast.error(error.message);
    const list = (data || []) as PendingRow[];
    setPendings(list);
    const saleIds = list.filter((p) => p.source_type === "pos_sale").map((p) => p.source_id);
    if (saleIds.length) {
      const { data: sales } = await supabase.from("pos_sales").select("id, sale_type").in("id", saleIds);
      setSaleTypes(Object.fromEntries((sales || []).map((s) => [s.id, s.sale_type || "physical"])));
    } else setSaleTypes({});
    setLoading(false);
  };

  useEffect(() => { if (open) { setView("config"); void loadConfig(); } }, [open]);

  const save = async () => {
    if (!defaultCompanyId) return toast.error("Escolha a empresa padrão");
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id || null;
      const old = JSON.parse(original || "{}");
      if (old.enabled !== enabled || old.defaultCompanyId !== defaultCompanyId) {
        const { error } = await supabase.from("fiscal_gateway_company_config").update({
          emit_by_gateway: enabled, default_company_id: defaultCompanyId,
          updated_at: new Date().toISOString(), updated_by: userId,
        }).eq("id", true);
        if (error) throw error;
      }
      const oldRows = new Map((old.rows || []).map((r: any[]) => [r[0], r]));
      for (const row of rows) {
        const before = oldRows.get(row.id);
        if (before && before[1] === row.company_id && before[2] === row.is_active) continue;
        const { error } = await supabase.from("fiscal_gateway_company_map").update({
          company_id: row.company_id, is_active: row.is_active,
          updated_at: new Date().toISOString(), updated_by: userId,
        }).eq("id", row.id);
        if (error) throw error;
      }
      setOriginal(snapshot);
      toast.success(`Configuração salva. Emissão pelo CNPJ do gateway: ${enabled ? "ligada" : "desligada"}.`);
    } catch (e: any) {
      toast.error(e.message || "Não foi possível salvar. A alteração exige usuário administrador.");
    } finally {
      setSaving(false);
    }
  };

  const emitManual = async (companyId: string) => {
    if (!manualPending) return;
    setEmitting(true);
    try {
      const saleType = saleTypes[manualPending.source_id];
      const fn = manualPending.source_type === "order" || ["online", "live", "pickup"].includes(saleType)
        ? "nfe-emitir" : "nfce-emitir";
      const body = manualPending.source_type === "order"
        ? { order_id: manualPending.source_id, company_id: companyId }
        : { sale_id: manualPending.source_id, company_id: companyId };
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw new Error(await extractEdgeError(error, "Erro ao emitir nota"));
      if (!data?.ok && !data?.contingencia) throw new Error(data?.error || "Nota não autorizada");
      toast.success(data.contingencia ? "Nota enviada para a contingência." : `Nota ${data.numero || ""} autorizada.`);
      setManualPending(null);
      await loadPendings();
    } catch (e: any) {
      toast.error(e.message || "Erro ao emitir nota", { duration: 12000 });
    } finally {
      setEmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Settings2 className="h-4 w-4" /> Emissão por CNPJ
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Emissão pelo CNPJ do gateway</DialogTitle>
            <DialogDescription>Desligado, tudo continua exatamente como hoje: loja ou escolha manual.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button size="sm" variant={view === "config" ? "default" : "outline"} onClick={() => { setView("config"); void loadConfig(); }}>Configuração</Button>
            <Button size="sm" variant={view === "pendings" ? "default" : "outline"} onClick={() => { setView("pendings"); void loadPendings(); }}>Pendências</Button>
          </div>

          {loading ? <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : view === "config" ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Emitir pelo CNPJ do gateway</p>
                  <p className="text-sm text-muted-foreground">O padrão entregue é desligado. Ligue somente depois de conferir a simulação.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Emitir pelo CNPJ do gateway" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Empresa padrão para gateways não mapeados</label>
                <Select value={defaultCompanyId} onValueChange={setDefaultCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Escolha a empresa" /></SelectTrigger>
                  <SelectContent>{activeCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name} — {cnpj(c.cnpj)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border">
                <div className="grid grid-cols-[1fr_2fr_auto] gap-3 border-b p-3 text-xs font-medium text-muted-foreground">
                  <span>Gateway</span><span>Empresa emissora</span><span>Ativa</span>
                </div>
                {rows.map((row, index) => (
                  <div key={row.id} className="grid grid-cols-[1fr_2fr_auto] items-center gap-3 border-b p-3 last:border-0">
                    <span className="text-sm font-medium">{gatewayLabel(row.gateway)}</span>
                    <Select value={row.company_id} onValueChange={(value) => setRows((old) => old.map((r, i) => i === index ? { ...r, company_id: value } : r))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{activeCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name} — {cnpj(c.cnpj)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Switch checked={row.is_active} onCheckedChange={(value) => setRows((old) => old.map((r, i) => i === index ? { ...r, is_active: value } : r))} aria-label={`Regra ${gatewayLabel(row.gateway)} ativa`} />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving || snapshot === original} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar configuração
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {!pendings.length ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma pendência de emissão por CNPJ.</p> : pendings.map((p) => (
                <div key={p.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="font-medium">{p.reason}</p>
                      <p className="text-xs text-muted-foreground break-all">{p.source_type === "pos_sale" ? "Venda" : "Pedido"}: {p.source_id}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">{p.gateways.map((g) => <Badge key={g} variant="outline">{gatewayLabel(g)}</Badge>)}</div>
                  <p className="text-xs text-muted-foreground">CNPJs envolvidos: {p.company_ids.map((id) => cnpj(companyById.get(id)?.cnpj)).join(" / ")}</p>
                  <Button size="sm" onClick={() => setManualPending(p)}>Escolher CNPJ e emitir manualmente</Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <SelectCompanyDialog open={!!manualPending} onClose={() => setManualPending(null)} onConfirm={emitManual} loading={emitting} title="Escolher CNPJ e emitir nota" />
    </>
  );
}
