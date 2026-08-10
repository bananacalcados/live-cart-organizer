import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Dices, Gift, Loader2, Plus, RotateCcw, Save, Trash2, Users } from "lucide-react";

interface Raffle {
  id: string;
  event_id: string;
  name: string;
  prize_label: string;
  prize_type: string;
  prize_value: number;
  expiry_days: number;
  winners_count: number;
  audience: string;
  min_purchase_value: number;
  exclude_previous_winners: boolean;
  status: string;
  drawn_at: string | null;
}

interface Winner {
  id: string;
  raffle_id: string;
  phone: string;
  display_name: string | null;
  position: number;
  voided_at: string | null;
}

const AUDIENCES = [
  { value: "confirmed_orders", label: "Pedidos confirmados" },
  { value: "payers", label: "Pagadores" },
  { value: "live_leads", label: "Cadastrados na Live (sem pedido)" },
];

const PRIZE_TYPES = [
  { value: "product", label: "Prêmio físico" },
  { value: "discount_percent", label: "Desconto %" },
  { value: "discount_fixed", label: "Desconto R$" },
  { value: "free_shipping", label: "Frete grátis" },
];

const maskPhone = (p: string) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 6) return p;
  return `(${d.slice(-11, -9)}) ****-${d.slice(-4)}`;
};

interface Draft {
  name: string;
  prize_label: string;
  prize_type: string;
  prize_value: number;
  expiry_days: number;
  winners_count: number;
  audience: string;
  min_purchase_value: number;
  exclude_previous_winners: boolean;
}

const emptyDraft = (): Draft => ({
  name: "Sorteio da Live",
  prize_label: "Bolsa",
  prize_type: "product",
  prize_value: 0,
  expiry_days: 30,
  winners_count: 1,
  audience: "confirmed_orders",
  min_purchase_value: 0,
  exclude_previous_winners: true,
});

async function callRaffle(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("event-raffle", { body: payload });
  if (error) {
    const ctx = (error as any)?.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const b = await ctx.json();
        if (b && typeof b === "object") return b as any;
      } catch { /* ignora */ }
    }
    throw new Error(error.message);
  }
  return data as any;
}

/** Animação de rolagem dos nomes até parar no ganhador. */
function DrawRoll({ names, winner }: { names: string[]; winner: string }) {
  const [current, setCurrent] = useState(names[0] || winner);
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let delay = 60;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed > 3200) {
        setCurrent(winner);
        setDone(true);
        return;
      }
      setCurrent(names[Math.floor(Math.random() * names.length)] || winner);
      delay = 60 + Math.pow(elapsed / 500, 2) * 8;
      timer.current = window.setTimeout(tick, delay);
    };
    tick();
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [names, winner]);

  return (
    <div className={`rounded-xl border-2 p-6 text-center transition-colors ${done ? "border-primary bg-primary/10" : "border-dashed border-muted-foreground/40"}`}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
        {done ? "Ganhador(a)" : "Sorteando..."}
      </p>
      <p className={`font-black ${done ? "text-2xl text-primary" : "text-xl opacity-70"}`}>{current}</p>
    </div>
  );
}

export function EventRafflesManager({ eventId }: { eventId: string }) {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [winners, setWinners] = useState<Record<string, Winner[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [rolls, setRolls] = useState<Record<string, { names: string[]; winner: string }>>({});

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const [{ data: rs }, { data: ws }] = await Promise.all([
      supabase.from("event_raffles").select("*").eq("event_id", eventId).order("created_at"),
      supabase
        .from("event_raffle_winners")
        .select("*, raffle:event_raffles!inner(event_id)")
        .eq("raffle.event_id", eventId)
        .order("position"),
    ]);
    setRaffles((rs as any[]) || []);
    const map: Record<string, Winner[]> = {};
    for (const w of (ws as any[]) || []) {
      (map[w.raffle_id] ||= []).push(w);
    }
    setWinners(map);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  /** Contagem de participantes de cada sorteio ainda em rascunho. */
  const refreshCount = useCallback(async (raffle: Raffle) => {
    try {
      const res = await callRaffle({ action: "preview", raffle_id: raffle.id });
      if (res?.ok) setCounts((c) => ({ ...c, [raffle.id]: res.count }));
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    raffles.filter((r) => r.status === "draft").forEach(refreshCount);
  }, [raffles, refreshCount]);

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.prize_label.trim()) {
      toast.error("Informe o nome e o prêmio");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("event_raffles").insert({ ...draft, event_id: eventId });
    setSaving(false);
    if (error) { toast.error("Erro ao criar sorteio"); return; }
    toast.success("Sorteio criado!");
    setDraft(null);
    load();
  };

  const removeRaffle = async (id: string) => {
    const { error } = await supabase.from("event_raffles").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setRaffles((rs) => rs.filter((r) => r.id !== id));
  };

  const doDraw = async (raffle: Raffle) => {
    setDrawing(raffle.id);
    try {
      const res = await callRaffle({ action: "draw", raffle_id: raffle.id });
      if (!res?.ok) {
        toast.error(
          res?.error === "empty_pool"
            ? "Nenhum participante elegível para este sorteio"
            : res?.error === "already_drawn"
              ? "Este sorteio já foi realizado"
              : res?.error || "Falha ao sortear",
        );
        return;
      }
      const names: string[] = (res.pool || [])
        .map((p: any) => p.display_name || "Cliente")
        .filter(Boolean);
      const first = res.winners?.[0];
      setRolls((r) => ({
        ...r,
        [raffle.id]: { names: names.length ? names : ["Cliente"], winner: first?.display_name || maskPhone(first?.phone || "") },
      }));
      setTimeout(load, 3600);
    } catch (e: any) {
      toast.error(e.message || "Erro ao sortear");
    } finally {
      setDrawing(null);
    }
  };

  const voidDraw = async (raffle: Raffle) => {
    try {
      const res = await callRaffle({ action: "void", raffle_id: raffle.id });
      if (!res?.ok) { toast.error(res?.error || "Falha ao anular"); return; }
      setRolls((r) => { const n = { ...r }; delete n[raffle.id]; return n; });
      toast.success("Sorteio anulado — pode sortear de novo");
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao anular");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Dices className="h-5 w-5 text-primary" /> Sorteios
          </h3>
          <p className="text-sm text-muted-foreground">
            Um prêmio, vários concorrendo — sorteio feito por você ao vivo.
          </p>
        </div>
        {!draft && (
          <Button onClick={() => setDraft(emptyDraft())} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Novo sorteio
          </Button>
        )}
      </div>

      {draft && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Novo sorteio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Prêmio</Label>
                <Input
                  value={draft.prize_label}
                  onChange={(e) => setDraft({ ...draft, prize_label: e.target.value })}
                  placeholder="Ex.: Bolsa"
                />
              </div>
              <div className="space-y-1">
                <Label>Tipo do prêmio</Label>
                <Select value={draft.prize_type} onValueChange={(v) => setDraft({ ...draft, prize_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIZE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.prize_type !== "product" && (
                <div className="space-y-1">
                  <Label>Valor do prêmio</Label>
                  <Input
                    type="number"
                    value={draft.prize_value}
                    onChange={(e) => setDraft({ ...draft, prize_value: Number(e.target.value) })}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>Quem participa</Label>
                <Select value={draft.audience} onValueChange={(v) => setDraft({ ...draft, audience: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUDIENCES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quantidade de ganhadores</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.winners_count}
                  onChange={(e) => setDraft({ ...draft, winners_count: Math.max(1, Number(e.target.value)) })}
                />
              </div>
              {draft.audience !== "live_leads" && (
                <div className="space-y-1">
                  <Label>Compra mínima (R$)</Label>
                  <Input
                    type="number"
                    value={draft.min_purchase_value}
                    onChange={(e) => setDraft({ ...draft, min_purchase_value: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Excluir quem já ganhou neste evento</p>
                <p className="text-xs text-muted-foreground">Evita a mesma cliente ganhar dois sorteios.</p>
              </div>
              <Switch
                checked={draft.exclude_previous_winners}
                onCheckedChange={(v) => setDraft({ ...draft, exclude_previous_winners: v })}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button onClick={saveDraft} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Criar</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {raffles.length === 0 && !draft && (
        <div className="text-center py-10 text-muted-foreground">
          <Dices className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum sorteio criado para este evento</p>
        </div>
      )}

      {raffles.map((r) => {
        const rWinners = (winners[r.id] || []).filter((w) => !w.voided_at);
        const roll = rolls[r.id];
        return (
          <Card key={r.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Gift className="h-4 w-4 text-primary" />
                {r.name}
                <Badge variant="secondary">{r.prize_label}</Badge>
                <Badge variant="outline">
                  {AUDIENCES.find((a) => a.value === r.audience)?.label || r.audience}
                </Badge>
                {r.status === "drawn" && <Badge className="bg-emerald-600">Sorteado</Badge>}
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {r.status === "draft" ? `${counts[r.id] ?? "..."} participantes` : `${(winners[r.id] || []).length} ganhador(es)`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {roll && <DrawRoll names={roll.names} winner={roll.winner} />}

              {!roll && rWinners.length > 0 && (
                <div className="space-y-2">
                  {rWinners.map((w) => (
                    <div key={w.id} className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 p-3">
                      <div>
                        <p className="font-semibold text-sm">
                          {w.position}º · {w.display_name || "Cliente"}
                        </p>
                        <p className="text-xs text-muted-foreground">{maskPhone(w.phone)}</p>
                      </div>
                      <Badge variant="outline">{r.prize_label}</Badge>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                {r.status === "draft" ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => removeRaffle(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" onClick={() => doDraw(r)} disabled={drawing === r.id}>
                      {drawing === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Dices className="h-4 w-4 mr-1" /> SORTEAR</>}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => voidDraw(r)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Anular e sortear de novo
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
