import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowRightLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Item { id: string; name: string; }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "category" | "brand";
  from: Item;
  candidates: Item[];
  onDone?: () => void;
}

export function TransferProductsDialog({ open, onOpenChange, mode, from, candidates, onDone }: Props) {
  const [toId, setToId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function run() {
    if (!toId || toId === from.id) return;
    setSaving(true);
    const rpc = mode === "brand" ? "transfer_products_brand" : "transfer_products_category";
    const { data, error } = await supabase.rpc(rpc as any, { p_from: from.id, p_to: toId });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${data ?? 0} produto(s) transferido(s)`);
    onOpenChange(false);
    onDone?.();
  }

  const options = candidates.filter(c => c.id !== from.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Transferir produtos {mode === "brand" ? "da marca" : "da categoria"}
          </DialogTitle>
          <DialogDescription>
            Todos os produtos de <b>{from.name}</b> serão movidos para a{" "}
            {mode === "brand" ? "marca" : "categoria"} escolhida.
            Depois disso, você pode excluir "{from.name}" se quiser.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Select value={toId} onValueChange={setToId}>
            <SelectTrigger><SelectValue placeholder="Selecione o destino" /></SelectTrigger>
            <SelectContent>
              {options.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={run} disabled={!toId || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
