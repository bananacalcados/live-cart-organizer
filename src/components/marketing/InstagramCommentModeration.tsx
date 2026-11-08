import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Eye, Check, Send, ExternalLink } from "lucide-react";

type Row = any;
type Tab = "ocultados" | "contatar" | "duvidas";
const PAGE = 50;
const CLASS_LABEL: Record<string, string> = {
  pedido_rastreio: "Pedido / rastreio",
  acusacao: "Acusação",
  ofensa_spam: "Ofensa / spam",
  duvida: "Dúvida",
  neutro_positivo: "Neutro / positivo",
};
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

async function act(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("ig-comment-moderation-action", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as any).context?.json())?.error || msg; } catch { /* mantém */ }
    throw new Error(msg);
  }
  return data;
}

function Summary({ s }: { s: any }) {
  const reviewed = Number(s?.reviewed || 0);
  const acc = reviewed ? Math.round((1 - Number(s.unhidden || 0) / reviewed) * 100) : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Ocultados em 24h</div><div className="text-2xl font-bold">{s?.hidden_24h ?? "—"}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">% de acerto (30 dias)</div><div className="text-2xl font-bold">{acc == null ? "—" : `${acc}%`}</div><div className="text-xs text-muted-foreground">{reviewed} revisados</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Esperando contato</div><div className="text-2xl font-bold">{s?.to_contact ?? "—"}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Dúvidas sem resposta</div><div className="text-2xl font-bold">{s?.doubts_open ?? "—"}</div></CardContent></Card>
    </div>
  );
}

function CommentHead({ r }: { r: Row }) {
  return (
    <div className="flex gap-3">
      {r.media_thumb ? <img src={r.media_thumb} alt="" className="h-16 w-16 rounded object-cover shrink-0" loading="lazy" /> : <div className="h-16 w-16 rounded bg-muted shrink-0" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">@{String(r.username || "").replace(/^@/, "")}</span>
          {r.class && <Badge variant="secondary">{CLASS_LABEL[r.class] || r.class}</Badge>}
          {r.confidence != null && <span className="text-xs text-muted-foreground">{Math.round(Number(r.confidence) * 100)}%</span>}
          <span className="text-xs text-muted-foreground">{fmt(r.received_at)}</span>
          {r.media_permalink && <a href={r.media_permalink} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 text-primary"><ExternalLink className="h-3 w-3" />post</a>}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{r.text_original}</p>
        {r.reason && <p className="text-xs text-muted-foreground">Motivo: {r.reason}</p>}
      </div>
    </div>
  );
}

function ListTab({ tab, onChanged }: { tab: Tab; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("ig_moderation_list" as any, { p_tab: tab, p_limit: PAGE, p_offset: offset, p_search: query || null });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const list = (data as Row[]) || [];
    setRows((prev) => (offset === 0 ? list : [...prev, ...list]));
    setHasMore(list.length === PAGE);
  }, [tab, query]);

  useEffect(() => { load(0); }, [load]);

  const run = async (r: Row, body: Record<string, unknown>, patch: Partial<Row>, ok: string) => {
    setBusy(r.id);
    try {
      await act({ id: r.id, ...body });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
      toast.success(ok);
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
        <Input placeholder="Buscar por @" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Button type="submit" variant="outline">Buscar</Button>
      </form>
      {rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">Nada por aqui.</p>}
      {rows.map((r) => (
        <Card key={r.id}><CardContent className="p-4 space-y-3">
          <CommentHead r={r} />
          {tab === "ocultados" && (
            <div className="flex flex-wrap items-center gap-2">
              {r.unhidden_at ? <Badge variant="outline">Reexibido {fmt(r.unhidden_at)}</Badge> : (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => run(r, { action: "unhide" }, { unhidden_at: new Date().toISOString(), review_verdict: "wrong" }, "Comentário reexibido")}><Eye className="h-4 w-4 mr-1" />Reexibir</Button>
              )}
              {r.review_verdict === "correct" ? <Badge>Confirmado</Badge> : !r.unhidden_at && (
                <Button size="sm" disabled={busy === r.id} onClick={() => run(r, { action: "confirm" }, { review_verdict: "correct" }, "Marcado como certo")}><Check className="h-4 w-4 mr-1" />Estava certo</Button>
              )}
              {r.private_reply_sent_at && <Badge variant="secondary">Direct enviado</Badge>}
              {r.private_reply_error && r.private_reply_error !== "enviando" && <Badge variant="destructive">Direct falhou</Badge>}
            </div>
          )}
          {tab === "contatar" && (
            <div className="space-y-2">
              {r.customer_name ? (
                <p className="text-sm">Cliente: <b>{r.customer_name}</b> {r.customer_phone && <> · <a className="text-primary" href={`https://wa.me/${String(r.customer_phone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{r.customer_phone}</a></>}</p>
              ) : <p className="text-xs text-muted-foreground">@ não encontrado no cadastro.</p>}
              <Textarea placeholder="Anotação" defaultValue={r.contact_note || ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} rows={2} />
              <div className="flex flex-wrap gap-2">
                {(["a_contatar", "contatado", "resolvido"] as const).map((st) => (
                  <Button key={st} size="sm" variant={r.contact_status === st ? "default" : "outline"} disabled={busy === r.id}
                    onClick={() => run(r, { action: "contact", contact_status: st, note: drafts[r.id] ?? r.contact_note ?? "" }, { contact_status: st, contact_note: drafts[r.id] ?? r.contact_note }, "Situação salva")}>
                    {st === "a_contatar" ? "A contatar" : st === "contatado" ? "Contatado" : "Resolvido"}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {tab === "duvidas" && (
            r.public_reply_sent_at ? <Badge>Respondido {fmt(r.public_reply_sent_at)}</Badge> : (
              <div className="space-y-2">
                <Textarea rows={2} defaultValue={r.suggested_reply || ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} />
                <Button size="sm" disabled={busy === r.id} onClick={() => run(r, { action: "public_reply", message: drafts[r.id] ?? r.suggested_reply ?? "" }, { public_reply_sent_at: new Date().toISOString() }, "Resposta publicada")}><Send className="h-4 w-4 mr-1" />Responder</Button>
              </div>
            )
          )}
        </CardContent></Card>
      ))}
      {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      {hasMore && !loading && <Button variant="outline" onClick={() => load(rows.length)}>Carregar mais</Button>}
    </div>
  );
}

function SettingsPanel({ cfg, onSaved }: { cfg: any; onSaved: (c: any) => void }) {
  const [c, setC] = useState(cfg);
  const [saving, setSaving] = useState(false);
  useEffect(() => setC(cfg), [cfg]);
  if (!c) return null;
  const save = async (patch: any) => {
    const next = { ...c, ...patch };
    setC(next);
    setSaving(true);
    const { error } = await supabase.from("ig_moderation_settings" as any).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true);
    setSaving(false);
    if (error) { toast.error("Só admin pode alterar: " + error.message); setC(c); return; }
    onSaved(next);
  };
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div><Label className="text-base">Moderação automática</Label><p className="text-xs text-muted-foreground">Oculta na hora; você confere depois.</p></div>
        <Switch checked={!!c.enabled} disabled={saving} onCheckedChange={(v) => save({ enabled: v })} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {(["pedido_rastreio", "acusacao", "ofensa_spam", "duvida"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between rounded border p-2">
            <span className="text-sm">{CLASS_LABEL[k]}</span>
            <Switch checked={c.class_enabled?.[k] !== false} disabled={saving} onCheckedChange={(v) => save({ class_enabled: { ...c.class_enabled, [k]: v } })} />
          </div>
        ))}
      </div>
      {c.paused_until && new Date(c.paused_until) > new Date() && <p className="text-xs text-destructive">Pausada até {fmt(c.paused_until)} (limite do Instagram ou da IA).</p>}
      <div className="space-y-1"><Label>Direct para pedido/rastreio ({"{primeiro_nome}"})</Label>
        <Textarea rows={3} defaultValue={c.private_reply_template} onBlur={(e) => e.target.value !== c.private_reply_template && save({ private_reply_template: e.target.value })} /></div>
      <div className="space-y-1"><Label>Complemento com rastreio ({"{link_rastreio}"})</Label>
        <Textarea rows={2} defaultValue={c.private_reply_tracking_suffix} onBlur={(e) => e.target.value !== c.private_reply_tracking_suffix && save({ private_reply_tracking_suffix: e.target.value })} /></div>
      <div className="space-y-1"><Label>Resposta padrão para dúvidas</Label>
        <Textarea rows={2} defaultValue={c.public_reply_template} onBlur={(e) => e.target.value !== c.public_reply_template && save({ public_reply_template: e.target.value })} /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Confiança mínima para ocultar acusação</Label>
          <Input type="number" step="0.05" min="0.5" max="1" defaultValue={c.acusacao_min_confidence} onBlur={(e) => { const v = Number(e.target.value); if (v >= 0.5 && v <= 1 && v !== Number(c.acusacao_min_confidence)) save({ acusacao_min_confidence: v }); }} /></div>
        <div className="space-y-1"><Label>@ da equipe (nunca ocultar), separados por vírgula</Label>
          <Input defaultValue={(c.team_usernames || []).join(", ")} onBlur={(e) => save({ team_usernames: e.target.value.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean) })} /></div>
      </div>
    </CardContent></Card>
  );
}

export default function InstagramCommentModeration() {
  const [summary, setSummary] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const loadSummary = useCallback(async () => {
    const { data } = await supabase.rpc("ig_moderation_summary" as any);
    setSummary(data);
  }, []);
  useEffect(() => {
    loadSummary();
    supabase.from("ig_moderation_settings" as any).select("*").maybeSingle().then(({ data }) => setCfg(data));
  }, [loadSummary]);

  const daily = (summary?.daily || []) as any[];
  return (
    <div className="space-y-4">
      <Summary s={summary} />
      <Tabs defaultValue="ocultados">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="ocultados">Ocultados</TabsTrigger>
          <TabsTrigger value="contatar">Contatar no particular</TabsTrigger>
          <TabsTrigger value="duvidas">Dúvidas para responder</TabsTrigger>
          <TabsTrigger value="resumo">Resumo do dia</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="ocultados"><ListTab tab="ocultados" onChanged={loadSummary} /></TabsContent>
        <TabsContent value="contatar"><ListTab tab="contatar" onChanged={loadSummary} /></TabsContent>
        <TabsContent value="duvidas"><ListTab tab="duvidas" onChanged={loadSummary} /></TabsContent>
        <TabsContent value="resumo">
          <Card><CardHeader><CardTitle className="text-base">Últimos 7 dias</CardTitle></CardHeader><CardContent>
            {daily.length === 0 ? <p className="text-sm text-muted-foreground">Sem registros ainda.</p> : (
              <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Dia</th><th>Classe</th><th>Ocultados</th><th>Reexibidos</th><th>A contatar</th></tr></thead>
                <tbody>{daily.map((d) => <tr key={d.day + d.class} className="border-t"><td>{new Date(d.day + "T12:00:00").toLocaleDateString("pt-BR")}</td><td>{CLASS_LABEL[d.class] || d.class}</td><td>{d.hidden}</td><td>{d.unhidden}</td><td>{d.to_contact}</td></tr>)}</tbody></table>
            )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="config"><SettingsPanel cfg={cfg} onSaved={setCfg} /></TabsContent>
      </Tabs>
    </div>
  );
}
