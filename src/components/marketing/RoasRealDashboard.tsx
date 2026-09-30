import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Download, Loader2, RefreshCw, Save } from "lucide-react";
import { format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { toast } from "sonner";

const sb = supabase as any;
const GROUPS = ["LIVE", "WHATSAPP", "LEADS", "ENGAJAMENTO", "OUTROS"] as const;
type Group = (typeof GROUPS)[number];
type Agg = "week" | "month";

const brl = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const roas = (num: number, den: number) => (den > 0 ? (num / den).toFixed(1) + "x" : "—");

function classify(name: string | null): Group {
  const n = (name || "").toUpperCase();
  if (n.includes("LIVE") && n.includes("VENDA")) return "LIVE";
  if (n.includes("WHATS")) return "WHATSAPP";
  if (n.includes("LEAD")) return "LEADS";
  if (n.includes("ENG") || n.includes("ALCANCE")) return "ENGAJAMENTO";
  return "OUTROS";
}

function bucketKey(date: string, agg: Agg) {
  const d = parseISO(date);
  return agg === "week" ? format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") : format(d, "yyyy-MM");
}
const bucketLabel = (k: string, agg: Agg) =>
  agg === "week" ? format(parseISO(k), "dd/MM/yy") : format(parseISO(k + "-01"), "MM/yyyy");

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

async function fetchAll(table: string, select: string, dateCol: string, from: string, to: string) {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from(table).select(select).gte(dateCol, from).lte(dateCol, to).range(off, off + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

interface Row {
  key: string;
  ads: Record<Group, number>;
  disparos: number;
  rec: { live: number; whatsapp: number; online: number; loja: number; total: number };
}

export function RoasRealDashboard() {
  const [from, setFrom] = useState(format(startOfWeek(subWeeks(new Date(), 12), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [agg, setAgg] = useState<Agg>("week");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [spend, setSpend] = useState<any[]>([]);
  const [disp, setDisp] = useState<any[]>([]);
  const [rev, setRev] = useState<any[]>([]);
  const [attr, setAttr] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [lastRun, setLastRun] = useState<any>(null);
  const [rates, setRates] = useState<{ category: string; unit_cost_brl: number }[]>([]);
  const [tokenState, setTokenState] = useState<{ token_expires_at: string | null; last_refreshed_at: string | null; last_error: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, r, a, o, lr, rt] = await Promise.all([
        fetchAll("meta_ads_campaign_spend_daily", "campaign_id,campaign_name,date,spend", "date", from, to),
        fetchAll("v_dispatch_cost_daily", "date,cost_brl", "date", from, to),
        fetchAll("v_revenue_daily_by_channel", "date,rec_live,rec_whatsapp,rec_online,rec_loja,rec_total", "date", from, to),
        fetchAll("v_ad_attributed_sales", "*", "week_start", format(startOfWeek(parseISO(from), { weekStartsOn: 1 }), "yyyy-MM-dd"), to),
        sb.from("meta_ads_campaign_group_overrides").select("campaign_id,group_override"),
        sb.from("meta_ads_sync_runs").select("*").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("dispatch_unit_cost_rates").select("category,unit_cost_brl").order("category"),
      ]);
      const ts = await sb.from("meta_ads_token_state").select("token_expires_at,last_refreshed_at,last_error").eq("id", 1).maybeSingle();
      setTokenState(ts.data ?? null);
      setSpend(s); setDisp(d); setRev(r); setAttr(a);
      setOverrides(Object.fromEntries((o.data || []).map((x: any) => [x.campaign_id, x.group_override])));
      setLastRun(lr.data);
      setRates(rt.data || []);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const groupOf = useCallback(
    (id: string, name: string | null) => (overrides[id] as Group) || classify(name),
    [overrides],
  );

  const hasSpend = spend.length > 0;

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    const get = (k: string) => {
      if (!m.has(k))
        m.set(k, {
          key: k, disparos: 0,
          ads: { LIVE: 0, WHATSAPP: 0, LEADS: 0, ENGAJAMENTO: 0, OUTROS: 0 },
          rec: { live: 0, whatsapp: 0, online: 0, loja: 0, total: 0 },
        });
      return m.get(k)!;
    };
    spend.forEach((s) => { get(bucketKey(s.date, agg)).ads[groupOf(s.campaign_id, s.campaign_name)] += Number(s.spend) || 0; });
    disp.forEach((d) => { get(bucketKey(d.date, agg)).disparos += Number(d.cost_brl) || 0; });
    rev.forEach((r) => {
      const x = get(bucketKey(r.date, agg)).rec;
      x.live += Number(r.rec_live) || 0; x.whatsapp += Number(r.rec_whatsapp) || 0;
      x.online += Number(r.rec_online) || 0; x.loja += Number(r.rec_loja) || 0; x.total += Number(r.rec_total) || 0;
    });
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [spend, disp, rev, agg, groupOf]);

  const total = useMemo(() => {
    const t: Row = { key: "TOTAL", disparos: 0, ads: { LIVE: 0, WHATSAPP: 0, LEADS: 0, ENGAJAMENTO: 0, OUTROS: 0 }, rec: { live: 0, whatsapp: 0, online: 0, loja: 0, total: 0 } };
    rows.forEach((r) => {
      GROUPS.forEach((g) => (t.ads[g] += r.ads[g]));
      t.disparos += r.disparos;
      (Object.keys(t.rec) as (keyof Row["rec"])[]).forEach((k) => (t.rec[k] += r.rec[k]));
    });
    return t;
  }, [rows]);

  const calc = (r: Row) => {
    const adsTotal = GROUPS.reduce((s, g) => s + r.ads[g], 0);
    const cost = adsTotal + r.disparos;
    return {
      cost,
      roasLive: hasSpend ? roas(r.rec.live, r.ads.LIVE) : "—",
      roasSemLoja: roas(r.rec.total - r.rec.loja, cost),
      roasComLoja: roas(r.rec.total, cost),
    };
  };

  // Attributed sales table
  const attrRows = useMemo(() => {
    const spendBy = new Map<string, number>();
    spend.forEach((s) => {
      const g = groupOf(s.campaign_id, s.campaign_name);
      const src = g === "WHATSAPP" ? "whatsapp_ad" : g === "LEADS" ? "leads_ad" : null;
      if (!src) return;
      const k = bucketKey(s.date, agg) + "|" + src;
      spendBy.set(k, (spendBy.get(k) || 0) + (Number(s.spend) || 0));
    });
    const m = new Map<string, any>();
    attr.forEach((a) => {
      const k = bucketKey(a.week_start, agg) + "|" + a.source;
      const cur = m.get(k) || { key: bucketKey(a.week_start, agg), source: a.source, contacts: 0, bf: 0, rf: 0, bl: 0, rl: 0 };
      cur.contacts += Number(a.contacts) || 0;
      cur.bf += Number(a.buyers_fora_live) || 0; cur.rf += Number(a.revenue_fora_live) || 0;
      cur.bl += Number(a.buyers_live) || 0; cur.rl += Number(a.revenue_live) || 0;
      m.set(k, cur);
    });
    return [...m.entries()]
      .map(([k, v]) => ({ ...v, spend: spendBy.get(k) || 0 }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.source.localeCompare(b.source));
  }, [attr, spend, agg, groupOf]);

  const campaigns = useMemo(() => {
    const m = new Map<string, { name: string; spend: number }>();
    spend.forEach((s) => {
      const c = m.get(s.campaign_id) || { name: s.campaign_name, spend: 0 };
      c.spend += Number(s.spend) || 0;
      m.set(s.campaign_id, c);
    });
    return [...m.entries()].sort((a, b) => b[1].spend - a[1].spend);
  }, [spend]);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", { body: {} });
      if (error) throw error;
      if (data?.status === "token_missing") toast.warning("Token do Meta Ads não configurado. Os contatos de anúncio foram atualizados.");
      else if (data?.status === "error") toast.error("Meta Ads: " + data.error);
      else toast.success(`Meta Ads sincronizado: ${data?.rows_upserted ?? 0} linhas`);
      await load();
    } catch (e: any) {
      toast.error("Falha na sincronização: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const saveOverride = async (id: string, name: string, value: string) => {
    const { error } = value === "auto"
      ? await sb.from("meta_ads_campaign_group_overrides").delete().eq("campaign_id", id)
      : await sb.from("meta_ads_campaign_group_overrides").upsert({ campaign_id: id, campaign_name: name, group_override: value, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    setOverrides((o) => { const n = { ...o }; if (value === "auto") delete n[id]; else n[id] = value; return n; });
  };

  const saveRate = async (category: string, value: number) => {
    const { error } = await sb.from("dispatch_unit_cost_rates").update({ unit_cost_brl: value, updated_at: new Date().toISOString() }).eq("category", category);
    if (error) return toast.error(error.message);
    toast.success(`Tarifa ${category} salva`);
    load();
  };

  const mainHeader = ["Período", "Ads Live", "Ads WhatsApp", "Ads Leads", "Ads Engajamento", "Ads Outros", "Disparos", "Custo total", "Rec. Live", "Rec. WhatsApp", "Rec. Online", "Rec. Loja", "Rec. Total", "ROAS Live", "ROAS sem loja", "ROAS com loja"];
  const mainCells = (r: Row) => {
    const c = calc(r);
    const ad = (g: Group) => (hasSpend ? brl(r.ads[g]) : "—");
    return [r.key === "TOTAL" ? "Total" : bucketLabel(r.key, agg), ad("LIVE"), ad("WHATSAPP"), ad("LEADS"), ad("ENGAJAMENTO"), ad("OUTROS"), brl(r.disparos), brl(c.cost), brl(r.rec.live), brl(r.rec.whatsapp), brl(r.rec.online), brl(r.rec.loja), brl(r.rec.total), c.roasLive, c.roasSemLoja, c.roasComLoja];
  };
  const srcLabel = (s: string) => (s === "whatsapp_ad" ? "WhatsApp ad" : "Leads ad");
  const attrCells = (a: any) => [bucketLabel(a.key, agg), srcLabel(a.source), a.contacts, a.bf, brl(a.rf), a.bl, brl(a.rl), a.spend > 0 && a.contacts > 0 ? brl(a.spend / a.contacts) : "—"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
        <div>
          <label className="text-xs text-muted-foreground">Agrupar por</label>
          <Select value={agg} onValueChange={(v) => setAgg(v as Agg)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="week">Semana</SelectItem><SelectItem value="month">Mês</SelectItem></SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button size="sm" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}Sincronizar Meta Ads agora
          </Button>
          <span className="text-xs text-muted-foreground">
            {lastRun ? `Última sync: ${format(new Date(lastRun.ran_at), "dd/MM/yyyy HH:mm")} · ${lastRun.status === "ok" ? `${lastRun.rows_upserted} linhas` : lastRun.status === "token_missing" ? "token ausente" : "erro"}` : "Nenhuma sincronização ainda"}
          </span>
          {tokenState?.token_expires_at && (
            <span className="text-xs text-muted-foreground">Token válido até {format(new Date(tokenState.token_expires_at), "dd/MM/yyyy")}</span>
          )}
        </div>
      </div>

      {tokenState && (tokenState.last_error || (tokenState.token_expires_at && new Date(tokenState.token_expires_at).getTime() - Date.now() < 7 * 86400000)) && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 flex gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span>
              {tokenState.token_expires_at && new Date(tokenState.token_expires_at).getTime() - Date.now() < 7 * 86400000
                ? `O token do Meta Ads vence em ${format(new Date(tokenState.token_expires_at), "dd/MM/yyyy")}. `
                : ""}
              {tokenState.last_error && `Falha na renovação automática do token: ${tokenState.last_error}`}
            </span>
          </CardContent>
        </Card>
      )}

      {(!hasSpend || lastRun?.status === "token_missing") && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 flex gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span>
              {lastRun?.status === "token_missing"
                ? "O token do Meta Ads (META_ADS_ACCESS_TOKEN) não está configurado. As colunas de anúncios ficam vazias e o custo total considera só os disparos."
                : "Sem gasto de Meta Ads no período. As colunas de anúncios ficam vazias e o custo total considera só os disparos."}
              {lastRun?.status === "error" && ` Último erro: ${lastRun.error}`}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Custo × Receita</CardTitle>
          <Button variant="outline" size="sm" onClick={() => downloadCsv("roas-real.csv", mainHeader, [...rows, total].map(mainCells))}>
            <Download className="h-4 w-4 mr-1" />Exportar CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>{mainHeader.map((h) => <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>{mainCells(r).map((c, i) => <TableCell key={i} className="whitespace-nowrap text-xs">{c}</TableCell>)}</TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold">{mainCells(total).map((c, i) => <TableCell key={i} className="whitespace-nowrap text-xs">{c}</TableCell>)}</TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <div>
            <CardTitle className="text-base">Vendas de quem veio de anúncio</CardTitle>
            <p className="text-xs text-muted-foreground">Primeiro toque por telefone; compras em até 14 dias depois. Semana = semana do primeiro toque.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadCsv("vendas-anuncios.csv", ["Período", "Fonte", "Contatos", "Compradores fora da live", "Receita fora da live", "Compradores na live", "Receita na live", "Custo por contato"], attrRows.map(attrCells))}>
            <Download className="h-4 w-4 mr-1" />Exportar CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>{["Período", "Fonte", "Contatos", "Compr. fora live", "Receita fora live", "Compr. na live", "Receita na live", "Custo/contato"].map((h) => <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {attrRows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground">Sem dados no período</TableCell></TableRow>}
              {attrRows.map((a) => (
                <TableRow key={a.key + a.source}>{attrCells(a).map((c, i) => <TableCell key={i} className="whitespace-nowrap text-xs">{c}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Classificação das campanhas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {campaigns.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma campanha sincronizada ainda.</p>}
            {campaigns.map(([id, c]) => (
              <div key={id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate" title={c.name}>{c.name}</span>
                <span className="text-muted-foreground">{brl(c.spend)}</span>
                <Badge variant="outline">{classify(c.name)}</Badge>
                <Select value={overrides[id] || "auto"} onValueChange={(v) => saveOverride(id, c.name, v)}>
                  <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático</SelectItem>
                    {GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Tarifa por mensagem (Meta)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rates.map((r) => <RateRow key={r.category} category={r.category} value={Number(r.unit_cost_brl)} onSave={saveRate} />)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RateRow({ category, value, onSave }: { category: string; value: number; onSave: (c: string, v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex-1">{category}</span>
      <Input type="number" step="0.01" min="0" value={v} onChange={(e) => setV(e.target.value)} className="h-7 w-24" />
      <Button size="sm" variant="outline" className="h-7" disabled={Number(v) === value || isNaN(Number(v))} onClick={() => onSave(category, Number(v))}>
        <Save className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
