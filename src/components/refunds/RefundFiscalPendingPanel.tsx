import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { refundApi, type RefundFiscalPending } from "@/lib/refunds";
import { NewExchangePicker } from "@/components/pos/NewExchangePicker";
import { FinalizeExchangePicker } from "@/components/pos/FinalizeExchangePicker";

export function RefundFiscalPendingPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<RefundFiscalPending[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [sale, setSale] = useState<string | null>(null);
  const [confer, setConfer] = useState(false);
  const load = async (p: number) => {
    try { const r = await refundApi.fiscalPending(p); setRows(old => p ? [...old, ...r.rows] : r.rows); setMore(r.hasMore); setPage(p); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar."); }
  };
  useEffect(() => { void load(0); }, [refreshKey]);
  return <section className="space-y-3">
    <h3 className="text-lg font-black uppercase text-pos-text">Estorno sem nota de devolução</h3>
    {error && <p className="text-destructive">{error}</p>}
    {!rows.length && !error && <p className="text-sm text-muted-foreground">Nenhuma pendência encontrada.</p>}
    <div className="space-y-2">{rows.map(r => <article key={r.estorno_id} className="rounded-md border border-border p-3 text-sm space-y-1">
      <p className="font-semibold">{r.cliente || "Cliente"} · {Number(r.valor_estorno).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
      <p>{new Date(r.data_estorno).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Venda #{(r.venda_id || r.source_id).slice(0, 8).toUpperCase()}</p>
      <p>Nota de venda: {r.nota_venda_numero || "não localizada"} · {r.tem_registro_devolucao ? "Devolução registrada" : "Sem registro de devolução"}</p>
      {r.nota_venda_chave && <p className="break-all text-xs text-muted-foreground">{r.nota_venda_chave}</p>}
      {r.fiscal_override_by && <p>Exceção por {r.fiscal_override_by} · {r.fiscal_override_reason}</p>}
      {r.venda_id && <Button size="sm" variant="outline" onClick={() => setSale(r.venda_id)}>Registrar devolução agora</Button>}
      {r.tem_registro_devolucao && <Button size="sm" variant="outline" onClick={() => setConfer(true)}>Conferir devolução e NF-e</Button>}
    </article>)}</div>
    {more && <Button variant="outline" onClick={() => void load(page + 1)}>Carregar mais</Button>}
    {sale && <NewExchangePicker open initialSaleId={sale} onCancel={() => setSale(null)} onDone={() => { setSale(null); setConfer(true); }} />}
    {confer && <FinalizeExchangePicker open onCancel={() => setConfer(false)} onDone={() => { setConfer(false); void load(0); }} />}
  </section>;
}