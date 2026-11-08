import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BadgePercent, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EXPEDITION_GATEWAYS, expeditionGatewayLabel } from "@/lib/expeditionGateway";

type Rule = { gateway: string; percent: number; is_active: boolean };

/** Automatic per-gateway price reduction: applied server-side to open live/online sales without NF-e. */
export function GatewayPriceRulesDialog() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [gateway, setGateway] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("expedition_gateway_price_rules").select("gateway, percent, is_active").order("gateway");
    setRules(((data as any[]) || []).map((r) => ({ ...r, percent: Number(r.percent) })));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const save = async (g: string, p: number, active: boolean) => {
    if (!g || !(p > 0 && p < 100)) { toast.error("Escolha o gateway e uma % entre 0 e 100"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("save_expedition_gateway_price_rule", { p_gateway: g, p_percent: p, p_active: active });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const n = (data as any)?.applied ?? 0;
    toast.success(active ? `Regra salva. ${n} pedido(s) da Expedição reduzido(s) agora.` : "Regra pausada.");
    setGateway(""); setPercent("");
    load();
  };

  const remove = async (g: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("delete_expedition_gateway_price_rule", { p_gateway: g });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Regra removida"); load(); }
  };

  return (
    <>
      <Button variant="outline" className="h-12 font-bold border-2" onClick={() => setOpen(true)}>
        <BadgePercent className="h-5 w-5 mr-2" /> Redução automática por gateway
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Redução automática por gateway</DialogTitle>
            <DialogDescription>
              Pedidos da live/site pagos nesse gateway já entram na Expedição com o valor reduzido (a nota sai com o valor novo).
              Ao salvar, os pedidos abertos sem nota também são reduzidos. Pedido que já teve redução (ou que você desfez) não é mexido de novo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {rules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma regra ainda.</p>}
            {rules.map((r) => (
              <div key={r.gateway} className="flex items-center gap-2 p-2 rounded-md border">
                <span className="flex-1 font-bold text-sm">{expeditionGatewayLabel(r.gateway)}</span>
                <span className="font-black">{r.percent}%</span>
                <Switch checked={r.is_active} disabled={busy} onCheckedChange={(v) => save(r.gateway, r.percent, v)} />
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => remove(r.gateway)} aria-label="Remover regra">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 items-end pt-2 border-t">
            <div className="flex-1">
              <Select value={gateway} onValueChange={setGateway}>
                <SelectTrigger><SelectValue placeholder="Gateway" /></SelectTrigger>
                <SelectContent>
                  {EXPEDITION_GATEWAYS.filter((g) => g.value !== "unknown").map((g) => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input className="w-24" inputMode="decimal" placeholder="%" value={percent} onChange={(e) => setPercent(e.target.value)} />
            <Button disabled={busy} onClick={() => save(gateway, Number(percent.replace(",", ".")), true)}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
