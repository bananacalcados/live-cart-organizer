import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Dices, Eye, EyeOff, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { DEFAULT_OVERLAY_CONFIG, DEFAULT_OVERLAY_LAYOUT, OverlayConfig, OverlayItem, OverlayLayout, withOverlayDefaults } from "@/lib/liveOverlay";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";

const sb = supabase as any;
const newId = () => Math.random().toString(36).slice(2, 9);

function ItemList({ items, onChange, onShowNow }: { items: OverlayItem[]; onChange: (i: OverlayItem[]) => void; onShowNow?: (t: string) => void }) {
  const set = (idx: number, patch: Partial<OverlayItem>) => onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const copy = [...items];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={it.id} className="flex items-center gap-2">
          <Checkbox checked={it.enabled} onCheckedChange={(v) => set(idx, { enabled: !!v })} />
          <Input value={it.text} onChange={(e) => set(idx, { text: e.target.value })} />
          <Button size="icon" variant="ghost" onClick={() => move(idx, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => move(idx, 1)}><ArrowDown className="h-4 w-4" /></Button>
          {onShowNow && (
            <Button size="sm" variant="secondary" onClick={() => onShowNow(it.text)} className="gap-1 whitespace-nowrap">
              <Send className="h-3 w-3" /> Mostrar agora
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" className="gap-1" onClick={() => onChange([...items, { id: newId(), text: "", enabled: true }])}>
        <Plus className="h-3 w-3" /> Adicionar
      </Button>
    </div>
  );
}

export function LiveOverlayControl({ eventId }: { eventId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [cfg, setCfg] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [hidden, setHidden] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editPositions, setEditPositions] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [savingParticipants, setSavingParticipants] = useState(false);
  const [fakeHandles, setFakeHandles] = useState<string>(() => { try { return localStorage.getItem(`overlay-fake-handles:${eventId}`) ?? localStorage.getItem("overlay-fake-handles") ?? "@ana_paula\n@bia_souza\n@carla_lima\n@cliente_exemplo"; } catch { return ""; } });

  const changeLayout = (layout: OverlayLayout) => setCfg((c) => ({ ...c, layout }));
  // Serialize writes; merge only layout into the latest saved config, never draft form values.
  const saveLayout = (layout: OverlayLayout) => {
    changeLayout(layout);
    setLayoutSaving(true);
    saveQueue.current = saveQueue.current.then(async () => {
      const { data, error: readError } = await sb.from("live_overlay_settings").select("config").eq("event_id", eventId).single();
      if (readError) throw readError;
      if (JSON.stringify(withOverlayDefaults(data.config).layout) === JSON.stringify(layout) && data.config?.layout) return;
      const { error } = await sb.from("live_overlay_settings").update({ config: { ...data.config, layout }, updated_at: new Date().toISOString() }).eq("event_id", eventId);
      if (error) throw error;
    }).catch(() => { toast.error("Não foi possível salvar as posições. Tente novamente."); });
    const pending = saveQueue.current;
    void pending.then(() => { if (saveQueue.current === pending) setLayoutSaving(false); });
  };

  const loadDefaultTemplate = async (): Promise<OverlayConfig> => {
    const { data } = await sb.from("live_overlay_templates").select("config").eq("is_default", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return withOverlayDefaults(data?.config);
  };

  const load = useCallback(async () => {
    const [{ data: fixed }, { data: ev }, { data: st }] = await Promise.all([
      sb.rpc("overlay_fixed_token"),
      sb.from("events").select("overlay_token").eq("id", eventId).maybeSingle(),
      sb.from("live_overlay_settings").select("config, hidden").eq("event_id", eventId).maybeSingle(),
    ]);
    setToken(fixed || ev?.overlay_token || null);
    if (st) {
      setCfg(withOverlayDefaults(st.config));
      setHidden(!!st.hidden);
      let localDraft: string | null = null;
      try { localDraft = localStorage.getItem(`overlay-fake-handles:${eventId}`); } catch { /* optional draft */ }
      setFakeHandles(localDraft ?? st.config?.wheel?.test_handles ?? "@ana_paula\n@bia_souza\n@carla_lima\n@cliente_exemplo");
    } else {
      const c = await loadDefaultTemplate();
      await sb.from("live_overlay_settings").insert({ event_id: eventId, config: c });
      setCfg(c);
      setHidden(false);
    }
    setDirty(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const update = <K extends keyof OverlayConfig>(k: K, patch: Partial<OverlayConfig[K]>) => {
    setCfg((c) => ({ ...c, [k]: { ...c[k], ...patch } }));
    setDirty(true);
  };

  const apply = async () => {
    await saveQueue.current;
    const { error } = await sb.from("live_overlay_settings").upsert({ event_id: eventId, config: cfg, hidden, updated_at: new Date().toISOString() });
    if (error) return toast.error("Não foi possível aplicar");
    setDirty(false);
    toast.success("Aplicado na live");
  };

  const toggleHidden = async () => {
    const next = !hidden;
    const { error } = await sb.from("live_overlay_settings").update({ hidden: next, updated_at: new Date().toISOString() }).eq("event_id", eventId);
    if (error) return toast.error("Não foi possível alterar");
    setHidden(next);
  };

  const showNow = async (text: string) => {
    if (!text.trim()) return;
    const { error } = await sb.from("live_overlay_events").insert({ event_id: eventId, kind: "cta_now", payload: { text } });
    if (error) toast.error("Não foi possível mostrar");
    else toast.success("Enviado para a live");
  };

  // Roda a animação do sorteio no overlay com nome fictício, sem gravar ganhador.
  const changeParticipants = (value: string) => {
    setFakeHandles(value);
    try { localStorage.setItem(`overlay-fake-handles:${eventId}`, value); } catch { /* optional draft */ }
  };
  const saveParticipants = async (): Promise<boolean> => {
    setSavingParticipants(true);
    try {
      await saveQueue.current;
      const { data, error: readError } = await sb.from("live_overlay_settings").select("config").eq("event_id", eventId).single();
      if (readError) throw readError;
      if (data.config?.wheel?.test_handles !== fakeHandles) {
        const { error } = await sb.from("live_overlay_settings").update({
          config: { ...data.config, wheel: { ...data.config?.wheel, test_handles: fakeHandles } },
          updated_at: new Date().toISOString(),
        }).eq("event_id", eventId);
        if (error) throw error;
      }
      setCfg((current) => ({ ...current, wheel: { ...current.wheel, test_handles: fakeHandles } }));
      try { localStorage.removeItem(`overlay-fake-handles:${eventId}`); } catch { /* optional draft */ }
      return true;
    } catch {
      toast.error("Não foi possível salvar os participantes. Tente novamente.");
      return false;
    } finally { setSavingParticipants(false); }
  };
  const testRaffle = async () => {
    const labels = Array.from(new Set(fakeHandles.split(/[\n,]+/).map((h) => h.trim().replace(/^@?/, "@")).filter((h) => h.length > 1))).slice(0, 50);
    if (labels.length < 2) return toast.error("Crie pelo menos 2 @ fictícios");
    if (!(await saveParticipants())) return;
    const winner = labels[Math.floor(Math.random() * labels.length)];
    const { error } = await sb.from("live_overlay_events").insert({
      event_id: eventId,
      kind: "raffle_draw",
      payload: { winner_label: winner, handle: winner.slice(1), prize_label: "Prêmio teste", labels, test: true },
    });
    if (error) toast.error("Não foi possível testar");
    else toast.success(`Teste enviado: ${winner} (nenhum ganhador foi gravado)`);
  };

  const saveAsDefault = async () => {
    await sb.from("live_overlay_templates").update({ is_default: false }).eq("is_default", true);
    const { error } = await sb.from("live_overlay_templates").insert({ name: "Padrão", is_default: true, config: cfg });
    if (error) toast.error("Não foi possível salvar o modelo");
    else toast.success("Salvo como modelo padrão");
  };

  const loadDefault = async () => {
    setCfg(await loadDefaultTemplate());
    setDirty(true);
    toast.info("Modelo carregado — clique em Aplicar para valer na live");
  };

  const url = token ? `https://checkout.bananacalcados.com.br/overlay/${token}` : "";

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Link fixo do OBS</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={url} />
              <Button variant="outline" className="gap-1" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copiado"); }}><Copy className="h-4 w-4" /> Copiar</Button>
            </div>
            <p className="text-xs text-muted-foreground">No OBS: Fonte de navegador, largura 1080, altura 1920.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant={hidden ? "default" : "destructive"} className="gap-1" onClick={toggleHidden}>
                {hidden ? <><Eye className="h-4 w-4" /> Mostrar</> : <><EyeOff className="h-4 w-4" /> Ocultar tudo</>}
              </Button>
              <Button variant="outline" className="gap-1" onClick={testRaffle} disabled={savingParticipants}>
                <Dices className="h-4 w-4" /> Testar sorteio
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fake-handles">Participantes fictícios do teste (um @ por linha)</Label>
              <Textarea id="fake-handles" rows={4} value={fakeHandles} onChange={(e) => changeParticipants(e.target.value)} placeholder="@maria_teste" />
              <Button variant="outline" size="sm" className="gap-1" disabled={savingParticipants} onClick={async () => { if (await saveParticipants()) toast.success("Participantes salvos nesta live"); }}>
                <Save className="h-4 w-4" /> {savingParticipants ? "Salvando…" : "Salvar participantes"}
              </Button>
              <p className="text-xs text-muted-foreground">Só para ver a roleta no OBS — não entram no sorteio de verdade.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Faixa de informações</CardTitle>
            <Switch checked={cfg.ticker.enabled} onCheckedChange={(v) => update("ticker", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-3">
            <ItemList items={cfg.ticker.items} onChange={(items) => update("ticker", { items })} />
            <div className="flex items-center gap-2"><Label>Trocar a cada (segundos)</Label>
              <Input type="number" className="w-24" min={2} value={cfg.ticker.interval_seconds} onChange={(e) => update("ticker", { interval_seconds: Number(e.target.value) || 6 })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Barra do sorteio</CardTitle>
            <Switch checked={cfg.raffle_bar.enabled} onCheckedChange={(v) => update("raffle_bar", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Texto ({"{count}"} = participantes)</Label>
              <Input value={cfg.raffle_bar.text_template} onChange={(e) => update("raffle_bar", { text_template: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={cfg.raffle_bar.goal_enabled} onCheckedChange={(v) => update("raffle_bar", { goal_enabled: v })} /><Label>Meta</Label>
              <Input type="number" className="w-24" value={cfg.raffle_bar.goal_count} onChange={(e) => update("raffle_bar", { goal_count: Number(e.target.value) || 0 })} /></div>
            <div><Label>Texto da meta ({"{remaining}"} = faltam)</Label>
              <Input value={cfg.raffle_bar.goal_text} onChange={(e) => update("raffle_bar", { goal_text: e.target.value })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Relógios de pagamento</CardTitle>
            <Switch checked={cfg.payment_timers.enabled} onCheckedChange={(v) => update("payment_timers", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>Texto ({"{handle}"}, {"{timer}"}, {"{product}"}, {"{size}"})</Label>
            <Input value={cfg.payment_timers.template} onChange={(e) => update("payment_timers", { template: e.target.value })} />
            <div className="flex items-center gap-2"><Label>Tempo em tela (segundos)</Label>
              <Input type="number" className="w-24" min={2} value={cfg.payment_timers.duration_seconds} onChange={(e) => update("payment_timers", { duration_seconds: Number(e.target.value) || 6 })} /></div>
            <p className="text-xs text-muted-foreground">Fila: aparece um cliente por vez, cada um pelo tempo acima. Quem pagou ou venceu sai da fila. O tamanho da letra é ajustado no bloco "Relógios" do editor de posições.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Liberação de par</CardTitle>
            <Switch checked={cfg.expired_alert.enabled} onCheckedChange={(v) => update("expired_alert", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>Texto ({"{handle}"}, {"{product}"}, {"{size}"})</Label>
            <Input value={cfg.expired_alert.template} onChange={(e) => update("expired_alert", { template: e.target.value })} />
            <Label>Texto quando não há outro par ({"{handle}"})</Label>
            <Input value={cfg.expired_alert.template_no_stock} onChange={(e) => update("expired_alert", { template_no_stock: e.target.value })} />
            <div className="flex items-center gap-2"><Label>Duração (segundos)</Label>
              <Input type="number" className="w-24" min={2} value={cfg.expired_alert.duration_seconds} onChange={(e) => update("expired_alert", { duration_seconds: Number(e.target.value) || 8 })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Avisos automáticos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(["paid_alert", "assembled_alert"] as const).map((k) => (
              <div key={k} className="space-y-2">
                <div className="flex items-center gap-2"><Switch checked={cfg[k].enabled} onCheckedChange={(v) => update(k, { enabled: v })} />
                  <Label>{k === "paid_alert" ? "Pagamento confirmado ({handle}, {product})" : "Pedido montado ({handle})"}</Label></div>
                <Input value={cfg[k].template} onChange={(e) => update(k, { template: e.target.value })} />
                <div className="flex items-center gap-2"><Label>Duração (segundos)</Label>
                  <Input type="number" className="w-24" min={2} value={cfg[k].duration_seconds} onChange={(e) => update(k, { duration_seconds: Number(e.target.value) || 6 })} /></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Chamadas para ação</CardTitle>
            <Switch checked={cfg.cta.enabled} onCheckedChange={(v) => update("cta", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-3">
            <ItemList items={cfg.cta.items} onChange={(items) => update("cta", { items })} onShowNow={showNow} />
            <div className="flex items-center gap-2"><Label>Mostrar a cada (minutos)</Label>
              <Input type="number" className="w-24" min={1} value={cfg.cta.interval_minutes} onChange={(e) => update("cta", { interval_minutes: Number(e.target.value) || 10 })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Roleta ao vivo</CardTitle>
            <Switch checked={cfg.wheel.enabled} onCheckedChange={(v) => update("wheel", { enabled: v })} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1"><Label>Título (use {"{handle}"} para o @)</Label>
              <Input value={cfg.wheel.title_template} onChange={(e) => update("wheel", { title_template: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Label>Prêmio fica na tela por (segundos)</Label>
              <Input type="number" className="w-24" min={3} value={cfg.wheel.result_seconds} onChange={(e) => update("wheel", { result_seconds: Number(e.target.value) || 8 })} /></div>
            <p className="text-xs text-muted-foreground">O giro é feito na aba Roleta do evento, no botão "Girar ao vivo" de cada cliente.</p>
          </CardContent>
        </Card>


        <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3">
          <Button onClick={apply} disabled={!dirty || layoutSaving}>Aplicar</Button>
          <Button variant="outline" onClick={loadDefault}>Carregar modelo padrão</Button>
          <Button variant="outline" onClick={saveAsDefault}>Salvar como modelo padrão</Button>
          {dirty && <span className="self-center text-xs text-muted-foreground">Alterações ainda não aplicadas na live</span>}
        </div>
      </div>

      <div className="lg:w-[340px] shrink-0">
        <div className="sticky top-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Prévia</p>
            <div className="flex items-center gap-2"><Label htmlFor="edit-overlay-positions">Editar posições</Label><Switch id="edit-overlay-positions" checked={editPositions} onCheckedChange={setEditPositions} /></div>
          </div>
          {editPositions ? <>
            <OverlayLayoutEditor config={cfg} onChange={changeLayout} onSave={saveLayout} />
            <Button variant="outline" className="mt-3 gap-2" onClick={() => saveLayout(DEFAULT_OVERLAY_LAYOUT)}><RefreshCw className="h-4 w-4" />Restaurar posições padrão</Button>
            <p role="status" className="mt-2 text-xs text-muted-foreground">{layoutSaving ? "Salvando posições…" : "Posições aplicadas na live"}</p>
          </> :
          <div className="relative overflow-hidden rounded-xl bg-muted-foreground/40" style={{ width: 324, height: 576 }}>
            {token && (
              <iframe
                key={token}
                src={`/overlay/${token}`}
                title="Prévia do overlay"
                style={{ width: 1080, height: 1920, transform: "scale(0.3)", transformOrigin: "0 0", border: 0, background: "transparent" }}
              />
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}
