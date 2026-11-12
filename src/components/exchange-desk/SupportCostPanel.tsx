import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deskCall } from "./api";
type Day = { day: string; tokens: number; reserved: number; calls: number; prefiltered: number; suggestions: number; decisions: Record<string, number>; budget_stops: number };
type Cost = { today: string; budget: number; pause: string | null; days: Day[] };
const labels: Record<string, string> = { enviar_link: "Link", fila: "Equipe", conversa: "Conversa", presencial: "Presencial", consolidar_em_outra_instancia: "Outro número", instagram_whatsapp: "Instagram → WhatsApp", nada: "Não responder" };
const n = (v: number) => Number(v).toLocaleString("pt-BR");
export function SupportCostPanel() {
  const [data, setData] = useState<Cost | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const next = await deskCall<Cost>("support_cost_dashboard"); setData(p => JSON.stringify(p) === JSON.stringify(next) ? p : next); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar o consumo"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const today = data?.days.find(d => d.day === data.today);
  const yesterday = data ? new Date(Date.parse(`${data.today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10) : "";
  const periods = data ? [{ label: "Hoje", rows: data.days.filter(d => d.day === data.today) }, { label: "Ontem", rows: data.days.filter(d => d.day === yesterday) }, { label: "Últimos 7 dias", rows: data.days }] : [];
  return <section aria-label="Consumo do suporte" className="border-y py-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Consumo do suporte · modo sombra</h2><Button size="icon" variant="ghost" aria-label="Atualizar consumo" title="Atualizar consumo" disabled={loading} onClick={load}><RefreshCw className="h-4 w-4" /></Button></div>
    {error && <p className="text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="text-sm text-muted-foreground">Carregando consumo…</p>}
    {data && <><p className="text-sm text-muted-foreground">Teto diário: {n(data.budget)} tokens · Reservados agora: {n(today?.reserved ?? 0)}{data.pause ? ` · IA pausada: ${data.pause}` : ""}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 pr-3">Período</th><th className="pr-3">Tokens</th><th className="pr-3">Chamadas</th><th className="pr-3">Passaram no filtro</th><th className="pr-3">Sugestões</th><th>Paradas pelo teto</th></tr></thead><tbody>{periods.map(p => <tr key={p.label} className="border-b"><td className="py-2 pr-3">{p.label}</td>{(["tokens", "calls", "prefiltered", "suggestions", "budget_stops"] as const).map(k => <td key={k} className="pr-3 tabular-nums">{n(p.rows.reduce((a, d) => a + Number(d[k]), 0))}</td>)}</tr>)}</tbody></table></div>
      <details><summary className="cursor-pointer text-sm">Por dia e tipo de decisão</summary><div className="space-y-2 pt-2">{data.days.map(d => <div key={d.day} className="text-sm"><b>{d.day.split("-").reverse().join("/")}</b> · {n(d.tokens)} tokens · {n(d.calls)} chamadas · {n(d.prefiltered)} passaram · {n(d.suggestions)} sugestões<div className="text-muted-foreground">{Object.entries(d.decisions).map(([k,v]) => `${labels[k] ?? k}: ${n(v)}`).join(" · ") || "Sem sugestões"}</div></div>)}</div></details></>}
  </section>;
}