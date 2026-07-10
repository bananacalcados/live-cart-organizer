import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send, Plus, TrendingUp, Play, CheckCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";

interface Campaign {
  id: string;
  name: string;
  message: string | null;
  status: string;
  attribution_days: number;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  whatsapp_number_id: string | null;
  audience_filters: { group_names?: string[] } | null;
}

interface Roas {
  campaign_id: string;
  buyers: number;
  attributed_revenue: number;
  avg_ticket: number | null;
  conversion_rate: number | null;
}

const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OrphanDispatchPanel({ onChanged }: { onChanged?: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [roas, setRoas] = useState<Record<string, Roas>>({});
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const stopRef = useRef(false);

  // form
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [attributionDays, setAttributionDays] = useState("7");
  const [groupFilter, setGroupFilter] = useState<string>("__all__");

  const load = useCallback(async () => {
    const [{ data: camps }, { data: roasData }] = await Promise.all([
      supabase.from("mass_dispatch_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("mass_dispatch_roas").select("*"),
    ]);
    setCampaigns((camps as Campaign[]) || []);
    const map: Record<string, Roas> = {};
    for (const r of (roasData as Roas[]) || []) map[r.campaign_id] = r;
    setRoas(map);
  }, []);

  useEffect(() => {
    load();
    supabase
      .from("vip_group_membership_stats")
      .select("group_name")
      .then(({ data }) => setGroupNames((data || []).map((g: { group_name: string }) => g.group_name)));
  }, [load]);

  const createCampaign = async () => {
    if (!name.trim() || !message.trim() || !instanceId) {
      toast.error("Preencha nome, mensagem e instância.");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("mass_dispatch_campaigns").insert({
        name: name.trim(),
        message: message.trim(),
        whatsapp_number_id: instanceId,
        attribution_days: Number(attributionDays) || 7,
        audience_filters: groupFilter === "__all__" ? {} : { group_names: [groupFilter] },
        status: "draft",
      });
      if (error) throw error;
      toast.success("Campanha criada.");
      setOpen(false);
      setName(""); setMessage(""); setGroupFilter("__all__");
      await load();
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const runCampaign = async (c: Campaign) => {
    setRunningId(c.id);
    stopRef.current = false;
    try {
      // 1) prepara destinatários
      const prep = await supabase.functions.invoke("vip-orphan-dispatch", {
        body: { action: "prepare", campaign_id: c.id },
      });
      if (prep.error || prep.data?.error) throw new Error(prep.data?.error || prep.error.message);
      toast.success(`${prep.data.total_targets} destinatários. Iniciando envio…`);

      // 2) processa em lotes até terminar
      let done = false;
      while (!done && !stopRef.current) {
        const res = await supabase.functions.invoke("vip-orphan-dispatch", {
          body: { action: "process", campaign_id: c.id, batch_size: 25 },
        });
        if (res.error || res.data?.error) throw new Error(res.data?.error || res.error.message);
        done = res.data.done;
        await load();
      }
      if (done) toast.success("Disparo concluído!");
    } catch (e) {
      toast.error("Falha no disparo: " + (e as Error).message);
    } finally {
      setRunningId(null);
      await load();
      onChanged?.();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Dispare para a base de órfãos e acompanhe as vendas geradas (ROAS).
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" /> Nova campanha</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova campanha de disparo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reativação órfãos julho" />
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Use {{nome}} para personalizar (quando houver nome)."
                />
              </div>
              <div>
                <Label>Instância WhatsApp</Label>
                <WhatsAppNumberSelector value={instanceId} onValueChange={setInstanceId} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Público (grupo)</Label>
                  <Select value={groupFilter} onValueChange={setGroupFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os órfãos</SelectItem>
                      {groupNames.map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Janela ROAS (dias)</Label>
                  <Input type="number" min={1} value={attributionDays} onChange={(e) => setAttributionDays(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createCampaign} disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />} Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma campanha ainda.</p>
        )}
        {campaigns.map((c) => {
          const r = roas[c.id];
          const total = c.total_targets || 0;
          const progress = total ? Math.round(((c.sent_count + c.failed_count) / total) * 100) : 0;
          const isRunning = runningId === c.id;
          return (
            <Card key={c.id}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant={c.status === "completed" ? "default" : "secondary"}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.message}</p>
                    {c.audience_filters?.group_names?.length ? (
                      <p className="text-[11px] text-muted-foreground">Público: {c.audience_filters.group_names.join(", ")}</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">Público: todos os órfãos</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={c.status === "completed" ? "outline" : "default"}
                    disabled={isRunning || !!runningId}
                    onClick={() => runCampaign(c)}
                  >
                    {isRunning ? <Loader2 className="h-4 w-4 animate-spin" />
                      : c.status === "completed" ? <CheckCircle className="h-4 w-4" />
                      : <Play className="h-4 w-4" />}
                    {isRunning ? "Enviando…" : c.status === "completed" ? "Reenviar pendentes" : "Disparar"}
                  </Button>
                </div>

                {(total > 0 || isRunning) && (
                  <div className="space-y-1">
                    <Progress value={progress} />
                    <p className="text-xs text-muted-foreground">
                      {c.sent_count} enviados · {c.failed_count} falhas · {total} total
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-2 pt-1 border-t">
                  <Metric label="Compradores" value={r?.buyers ?? 0} />
                  <Metric label="Receita" value={brl(r?.attributed_revenue ?? 0)} highlight />
                  <Metric label="Ticket médio" value={r?.avg_ticket != null ? brl(r.avg_ticket) : "—"} />
                  <Metric label="Conversão" value={r?.conversion_rate != null ? `${r.conversion_rate}%` : "—"} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? "text-emerald-600" : ""}`}>{value}</p>
    </div>
  );
}
