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
import { Loader2, Plus, Trash2, Trophy, Users, Wallet } from "lucide-react";

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

export function EventPrizeWheelsManager({ eventId }: { eventId: string }) {
  const [wheels, setWheels] = useState<Wheel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

  const createWheel = async (audience: "payers" | "participants") => {
    setCreating(true);
    const { data, error } = await supabase
      .from("event_prize_wheels")
      .insert({
        event_id: eventId,
        name: audience === "payers" ? "Roleta dos Pagadores" : "Roleta da Live",
        audience,
        min_purchase_value: audience === "payers" ? 150 : 0,
        require_otp: audience === "participants",
      })
      .select("id")
      .maybeSingle();
    if (error || !data) {
      toast.error("Erro ao criar roleta");
      setCreating(false);
      return;
    }
    const defaults = [
      { label: "10% OFF", prize_type: "discount_percent", prize_value: 10, probability: 30 },
      { label: "Frete Grátis", prize_type: "free_shipping", prize_value: 0, probability: 25 },
      { label: "R$ 20 OFF", prize_type: "discount_fixed", prize_value: 20, probability: 20 },
      { label: "Não foi dessa vez", prize_type: "none", prize_value: 0, probability: 25 },
    ];
    await supabase.from("event_prize_wheel_segments").insert(
      defaults.map((d, i) => ({
        wheel_id: data.id,
        ...d,
        color: COLORS[i % COLORS.length],
        sort_order: i,
      })),
    );
    setCreating(false);
    toast.success("Roleta criada!");
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando roletas...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => createWheel("payers")} disabled={creating} className="gap-2">
          <Wallet className="h-4 w-4" /> Nova roleta de PAGADORES
        </Button>
        <Button onClick={() => createWheel("participants")} disabled={creating} variant="outline" className="gap-2">
          <Users className="h-4 w-4" /> Nova roleta de PARTICIPANTES
        </Button>
      </div>

      {wheels.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-3 opacity-60" />
            Nenhuma roleta criada para este evento.
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
                <p className="text-[11px] text-muted-foreground">
                  Colunas: cor · prêmio · tipo · valor · peso da chance (%) · validade em dias.
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
