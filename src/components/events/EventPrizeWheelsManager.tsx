import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Save, Trash2, Trophy, Users, Wallet } from "lucide-react";

interface Segment {
  id: string;
  wheel_id: string;
  label: string;
  color: string;
  prize_type: string;
  prize_value: number;
  probability: number;
  expiry_days: number;
  sort_order: number;
  is_active: boolean;
}

interface Wheel {
  id: string;
  event_id: string;
  name: string;
  audience: "payers" | "participants";
  is_active: boolean;
  min_purchase_value: number;
  require_otp: boolean;
  max_spins_per_customer: number;
  segments?: Segment[];
}

const PRIZE_TYPES = [
  { value: "discount_percent", label: "Desconto %" },
  { value: "discount_fixed", label: "Desconto R$" },
  { value: "free_shipping", label: "Frete grátis" },
  { value: "product", label: "Prêmio físico" },
  { value: "none", label: "Não foi dessa vez" },
];

const COLORS = ["#FF6B00", "#FFD93D", "#6BCB77", "#4D96FF", "#FF6B6B", "#B14AED", "#00C2A8", "#FF8FAB"];

interface DraftSegment {
  label: string;
  color: string;
  prize_type: string;
  prize_value: number;
  probability: number;
  expiry_days: number;
}

const DEFAULT_SEGMENTS: DraftSegment[] = [
  { label: "10% OFF", prize_type: "discount_percent", prize_value: 10, probability: 30, expiry_days: 30, color: COLORS[0] },
  { label: "Frete Grátis", prize_type: "free_shipping", prize_value: 0, probability: 25, expiry_days: 30, color: COLORS[1] },
  { label: "R$ 20 OFF", prize_type: "discount_fixed", prize_value: 20, probability: 20, expiry_days: 30, color: COLORS[2] },
  { label: "Não foi dessa vez", prize_type: "none", prize_value: 0, probability: 25, expiry_days: 30, color: COLORS[3] },
];

interface Draft {
  name: string;
  audience: "payers" | "participants";
  min_purchase_value: number;
  max_spins_per_customer: number;
  require_otp: boolean;
  segments: DraftSegment[];
}

const emptyDraft = (): Draft => ({
  name: "Roleta dos Pagadores",
  audience: "payers",
  min_purchase_value: 150,
  max_spins_per_customer: 1,
  require_otp: false,
  segments: DEFAULT_SEGMENTS.map((s) => ({ ...s })),
});

export function EventPrizeWheelsManager({ eventId }: { eventId: string }) {
  const [wheels, setWheels] = useState<Wheel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reusable, setReusable] = useState<{ id: string; name: string; audience: string; event_name: string }[]>([]);
  const [reuseId, setReuseId] = useState("");

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("event_prize_wheels")
      .select("*, segments:event_prize_wheel_segments(*)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) toast.error("Erro ao carregar roletas");
    setWheels(((data as any[]) || []).map((w) => ({
      ...w,
      segments: (w.segments || []).sort((a: Segment, b: Segment) => a.sort_order - b.sort_order),
    })));
    setLoading(false);
  }, [eventId]);

  /** Roletas criadas em OUTRAS lives — podem ser reaproveitadas aqui. */
  const loadReusable = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("event_prize_wheels")
      .select("id, name, audience, event_id, events(name)")
      .neq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(50);
    setReusable(
      ((data as any[]) || []).map((w) => ({
        id: w.id,
        name: w.name,
        audience: w.audience,
        event_name: w.events?.name || "Evento",
      })),
    );
  }, [eventId]);

  useEffect(() => {
    load();
    loadReusable();
  }, [load, loadReusable]);

  /** Salva o rascunho (roleta + prêmios) de uma vez. */
  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Dê um nome para a roleta");
      return;
    }
    if (draft.segments.length < 2) {
      toast.error("Adicione pelo menos 2 prêmios");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("event_prize_wheels")
      .insert({
        event_id: eventId,
        name: draft.name.trim(),
        audience: draft.audience,
        min_purchase_value: draft.audience === "payers" ? draft.min_purchase_value : 0,
        max_spins_per_customer: draft.max_spins_per_customer,
        require_otp: draft.require_otp,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) {
      toast.error("Erro ao salvar roleta");
      setSaving(false);
      return;
    }
    const { error: segError } = await supabase.from("event_prize_wheel_segments").insert(
      draft.segments.map((s, i) => ({ wheel_id: data.id, ...s, sort_order: i })),
    );
    setSaving(false);
    if (segError) {
      toast.error("Roleta criada, mas houve erro ao salvar os prêmios");
    } else {
      toast.success("Roleta salva!");
    }
    setDraft(null);
    load();
  };

  /** Duplica uma roleta de outra live para este evento. */
  const reuseWheel = async (wheelId: string) => {
    setSaving(true);
    const { data: src } = await supabase
      .from("event_prize_wheels")
      .select("*, segments:event_prize_wheel_segments(*)")
      .eq("id", wheelId)
      .maybeSingle();
    if (!src) {
      toast.error("Roleta não encontrada");
      setSaving(false);
      return;
    }
    const s = src as any;
    const { data: created, error } = await supabase
      .from("event_prize_wheels")
      .insert({
        event_id: eventId,
        name: s.name,
        audience: s.audience,
        min_purchase_value: s.min_purchase_value,
        max_spins_per_customer: s.max_spins_per_customer,
        require_otp: s.require_otp,
      })
      .select("id")
      .maybeSingle();
    if (error || !created) {
      toast.error("Erro ao reaproveitar roleta");
      setSaving(false);
      return;
    }
    const segs = (s.segments || []).sort((a: Segment, b: Segment) => a.sort_order - b.sort_order);
    if (segs.length) {
      await supabase.from("event_prize_wheel_segments").insert(
        segs.map((seg: Segment, i: number) => ({
          wheel_id: created.id,
          label: seg.label,
          color: seg.color,
          prize_type: seg.prize_type,
          prize_value: seg.prize_value,
          probability: seg.probability,
          expiry_days: seg.expiry_days,
          sort_order: i,
        })),
      );
    }
    setSaving(false);
    setReuseId("");
    toast.success("Roleta reaproveitada nesta live!");
    load();
  };

  const patchWheel = async (id: string, updates: Partial<Wheel>) => {
    setWheels((prev) => prev.map((w) => (w.id === id ? { ...w, ...updates } : w)));
    const { error } = await supabase.from("event_prize_wheels").update(updates as any).eq("id", id);
    if (error) {
      toast.error("Erro ao salvar");
      load();
    }
  };

  const removeWheel = async (id: string) => {
    await supabase.from("event_prize_wheels").delete().eq("id", id);
    setWheels((prev) => prev.filter((w) => w.id !== id));
  };

  const patchSegment = async (wheelId: string, segId: string, updates: Partial<Segment>) => {
    setWheels((prev) =>
      prev.map((w) =>
        w.id !== wheelId
          ? w
          : { ...w, segments: (w.segments || []).map((s) => (s.id === segId ? { ...s, ...updates } : s)) },
      ),
    );
    await supabase.from("event_prize_wheel_segments").update(updates as any).eq("id", segId);
  };

  const addSegment = async (wheel: Wheel) => {
    const order = (wheel.segments?.length || 0);
    const { data } = await supabase
      .from("event_prize_wheel_segments")
      .insert({
        wheel_id: wheel.id,
        label: "Novo prêmio",
        color: COLORS[order % COLORS.length],
        sort_order: order,
      })
      .select("*")
      .maybeSingle();
    if (data) {
      setWheels((prev) =>
        prev.map((w) => (w.id === wheel.id ? { ...w, segments: [...(w.segments || []), data as Segment] } : w)),
      );
    }
  };

  const removeSegment = async (wheelId: string, segId: string) => {
    await supabase.from("event_prize_wheel_segments").delete().eq("id", segId);
    setWheels((prev) =>
      prev.map((w) => (w.id !== wheelId ? w : { ...w, segments: (w.segments || []).filter((s) => s.id !== segId) })),
    );
  };

  const patchDraftSeg = (i: number, updates: Partial<DraftSegment>) =>
    setDraft((d) => (d ? { ...d, segments: d.segments.map((s, idx) => (idx === i ? { ...s, ...updates } : s)) } : d));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando roletas...
      </div>
    );
  }

  const draftTotalProb = draft ? draft.segments.reduce((s, x) => s + Number(x.probability || 0), 0) || 1 : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDraft(emptyDraft())} disabled={!!draft || saving} className="gap-2 font-bold">
          <Plus className="h-4 w-4" /> NOVA ROLETA
        </Button>

        {reusable.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={reuseId}
              onValueChange={(v) => {
                setReuseId(v);
                reuseWheel(v);
              }}
            >
              <SelectTrigger className="h-10 w-[300px]">
                <SelectValue placeholder="Reaproveitar roleta de outra live..." />
              </SelectTrigger>
              <SelectContent>
                {reusable.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {r.audience === "payers" ? "Pagadores" : "Participantes"} · {r.event_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Copy className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Rascunho de nova roleta — só é criada ao clicar em SALVAR ROLETA */}
      {draft && (
        <Card className="border-2 border-primary">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-amber-500" /> Nova roleta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Nome da roleta</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quem pode girar</Label>
                <Select
                  value={draft.audience}
                  onValueChange={(v: "payers" | "participants") =>
                    setDraft({
                      ...draft,
                      audience: v,
                      name:
                        draft.name === "Roleta dos Pagadores" || draft.name === "Roleta da Live"
                          ? v === "payers"
                            ? "Roleta dos Pagadores"
                            : "Roleta da Live"
                          : draft.name,
                      require_otp: v === "participants",
                    })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payers">
                      <span className="flex items-center gap-2"><Wallet className="h-3.5 w-3.5" /> Pagadores do evento</span>
                    </SelectItem>
                    <SelectItem value="participants">
                      <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Participantes da live</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Giros por cliente</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.max_spins_per_customer}
                  onChange={(e) =>
                    setDraft({ ...draft, max_spins_per_customer: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="h-9"
                />
              </div>
              {draft.audience === "payers" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Compra mínima no evento (R$)</Label>
                  <Input
                    type="number"
                    value={draft.min_purchase_value}
                    onChange={(e) => setDraft({ ...draft, min_purchase_value: Number(e.target.value) || 0 })}
                    className="h-9"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Confirmar WhatsApp (OTP)</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch
                      checked={draft.require_otp}
                      onCheckedChange={(v) => setDraft({ ...draft, require_otp: v })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {draft.require_otp ? "Obrigatório" : "Desligado"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Prêmios e chances</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      segments: [
                        ...draft.segments,
                        {
                          label: "Novo prêmio",
                          color: COLORS[draft.segments.length % COLORS.length],
                          prize_type: "discount_percent",
                          prize_value: 0,
                          probability: 10,
                          expiry_days: 30,
                        },
                      ],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Prêmio
                </Button>
              </div>

              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                <span className="col-span-1">Cor</span>
                <span className="col-span-3">Nome do prêmio</span>
                <span className="col-span-3">Tipo de prêmio</span>
                <span className="col-span-1">Valor</span>
                <span className="col-span-2">Chance (peso)</span>
                <span className="col-span-1">Validade</span>
                <span className="col-span-1" />
              </div>

              {draft.segments.map((seg, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center rounded-lg border p-2">
                  <input
                    type="color"
                    value={seg.color}
                    onChange={(e) => patchDraftSeg(i, { color: e.target.value })}
                    className="col-span-1 h-8 w-8 rounded cursor-pointer bg-transparent"
                    aria-label="Cor"
                  />
                  <Input
                    value={seg.label}
                    onChange={(e) => patchDraftSeg(i, { label: e.target.value })}
                    className="col-span-3 h-9"
                  />
                  <div className="col-span-3">
                    <Select value={seg.prize_type} onValueChange={(v) => patchDraftSeg(i, { prize_type: v })}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIZE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    type="number"
                    value={seg.prize_value}
                    onChange={(e) => patchDraftSeg(i, { prize_value: Number(e.target.value) || 0 })}
                    className="col-span-1 h-9"
                  />
                  <div className="col-span-2 flex items-center gap-1">
                    <Input
                      type="number"
                      value={seg.probability}
                      onChange={(e) => patchDraftSeg(i, { probability: Number(e.target.value) || 0 })}
                      className="h-9"
                    />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {Math.round((Number(seg.probability || 0) / draftTotalProb) * 100)}%
                    </span>
                  </div>
                  <Input
                    type="number"
                    value={seg.expiry_days}
                    onChange={(e) => patchDraftSeg(i, { expiry_days: Number(e.target.value) || 30 })}
                    className="col-span-1 h-9"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-span-1 text-destructive"
                    onClick={() => setDraft({ ...draft, segments: draft.segments.filter((_, idx) => idx !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button onClick={saveDraft} disabled={saving} size="lg" className="gap-2 font-bold">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} SALVAR ROLETA
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </Button>
              <span className="text-xs text-muted-foreground">
                A roleta só é criada depois de clicar em SALVAR — depois ela aparece na lista abaixo.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {wheels.length === 0 && !draft && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-3 opacity-60" />
            Nenhuma roleta criada para este evento. Clique em <strong>NOVA ROLETA</strong> ou reaproveite uma de outra live.
          </CardContent>
        </Card>
      )}


      {wheels.map((wheel) => {
        const totalProb = (wheel.segments || []).reduce((s, x) => s + Number(x.probability || 0), 0) || 1;
        return (
          <Card key={wheel.id} className={wheel.is_active ? "border-2 border-primary/60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  <Input
                    value={wheel.name}
                    onChange={(e) => patchWheel(wheel.id, { name: e.target.value })}
                    className="h-9 w-56 font-bold"
                  />
                </CardTitle>
                <Badge variant={wheel.audience === "payers" ? "default" : "secondary"}>
                  {wheel.audience === "payers" ? "Pagadores do evento" : "Participantes da live"}
                </Badge>
                <div className="ml-auto flex items-center gap-3">
                  <div
                    className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border-2 ${
                      wheel.is_active
                        ? "border-green-500/60 bg-green-500/10"
                        : "border-muted bg-muted/40"
                    }`}
                  >
                    <Switch
                      checked={wheel.is_active}
                      onCheckedChange={(v) => patchWheel(wheel.id, { is_active: v })}
                    />
                    <span
                      className={`text-sm font-black tracking-wide ${
                        wheel.is_active ? "text-green-600" : "text-muted-foreground"
                      }`}
                    >
                      {wheel.is_active ? "🎰 ROLETA ATIVADA" : "ROLETA DESATIVADA"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => removeWheel(wheel.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {wheel.audience === "payers" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Compra mínima no evento (R$)</Label>
                    <Input
                      type="number"
                      value={wheel.min_purchase_value}
                      onChange={(e) =>
                        patchWheel(wheel.id, { min_purchase_value: Number(e.target.value) || 0 })
                      }
                      className="h-9"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Giros por cliente</Label>
                  <Input
                    type="number"
                    min={1}
                    value={wheel.max_spins_per_customer}
                    onChange={(e) =>
                      patchWheel(wheel.id, { max_spins_per_customer: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="h-9"
                  />
                </div>
                {wheel.audience === "participants" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Confirmar WhatsApp (código OTP)</Label>
                    <div className="flex items-center gap-2 h-9">
                      <Switch
                        checked={wheel.require_otp}
                        onCheckedChange={(v) => patchWheel(wheel.id, { require_otp: v })}
                      />
                      <span className="text-xs text-muted-foreground">
                        {wheel.require_otp ? "Obrigatório" : "Desligado"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Prêmios e chances</Label>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => addSegment(wheel)}>
                    <Plus className="h-3.5 w-3.5" /> Prêmio
                  </Button>
                </div>

                <div className="hidden sm:grid grid-cols-12 gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                  <span className="col-span-1">Cor</span>
                  <span className="col-span-3">Nome do prêmio</span>
                  <span className="col-span-3">Tipo de prêmio</span>
                  <span className="col-span-1">Valor</span>
                  <span className="col-span-2">Chance (peso)</span>
                  <span className="col-span-1">Validade</span>
                  <span className="col-span-1" />
                </div>

                {(wheel.segments || []).map((seg) => (

                  <div
                    key={seg.id}
                    className="grid grid-cols-12 gap-2 items-center rounded-lg border p-2"
                  >
                    <input
                      type="color"
                      value={seg.color}
                      onChange={(e) => patchSegment(wheel.id, seg.id, { color: e.target.value })}
                      className="col-span-1 h-8 w-8 rounded cursor-pointer bg-transparent"
                      aria-label="Cor"
                    />
                    <Input
                      value={seg.label}
                      onChange={(e) => patchSegment(wheel.id, seg.id, { label: e.target.value })}
                      className="col-span-3 h-9"
                      placeholder="Nome do prêmio"
                    />
                    <div className="col-span-3">
                      <Select
                        value={seg.prize_type}
                        onValueChange={(v) => patchSegment(wheel.id, seg.id, { prize_type: v })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIZE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      value={seg.prize_value}
                      onChange={(e) =>
                        patchSegment(wheel.id, seg.id, { prize_value: Number(e.target.value) || 0 })
                      }
                      className="col-span-1 h-9"
                      placeholder="Valor"
                      title="Valor do prêmio"
                    />
                    <div className="col-span-2 flex items-center gap-1">
                      <Input
                        type="number"
                        value={seg.probability}
                        onChange={(e) =>
                          patchSegment(wheel.id, seg.id, { probability: Number(e.target.value) || 0 })
                        }
                        className="h-9"
                        title="Peso da chance"
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {Math.round((Number(seg.probability || 0) / totalProb) * 100)}%
                      </span>
                    </div>
                    <Input
                      type="number"
                      value={seg.expiry_days}
                      onChange={(e) =>
                        patchSegment(wheel.id, seg.id, { expiry_days: Number(e.target.value) || 30 })
                      }
                      className="col-span-1 h-9"
                      title="Validade (dias)"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="col-span-1 text-destructive"
                      onClick={() => removeSegment(wheel.id, seg.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="rounded-md border bg-muted/40 p-2 space-y-1 text-[11px] text-muted-foreground">
                  <p><strong className="text-foreground">Valor</strong> — depende do tipo: Desconto % = porcentagem (ex.: 10 = 10% OFF); Desconto R$ = reais (ex.: 20 = R$ 20 de desconto); Frete grátis, Prêmio físico e "Não foi dessa vez" = deixe 0 (o valor é ignorado).</p>
                  <p><strong className="text-foreground">Chance (peso)</strong> — não precisa somar 100. É um peso relativo: a % real aparece ao lado e é calculada como peso ÷ soma de todos os pesos. Peso maior = sai mais vezes; peso 0 = nunca sai.</p>
                  <p><strong className="text-foreground">Validade</strong> — por quantos dias o prêmio ganho fica válido para ser usado no próximo pedido (ex.: 30 = expira em 30 dias).</p>
                </div>

              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
