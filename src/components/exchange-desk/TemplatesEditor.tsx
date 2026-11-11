import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { loadTemplates, type DeskTemplate } from "./api";

export function TemplatesEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<DeskTemplate[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => { if (open) loadTemplates().then((t) => setItems(Object.values(t))); }, [open]);

  const save = async (t: DeskTemplate) => {
    setSaving(t.key);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await (supabase as any).from("exchange_message_templates")
      .update({ body: t.body, updated_at: new Date().toISOString(), updated_by: u.user?.id }).eq("key", t.key).select("key");
    setSaving(null);
    if (error || !data?.length) toast({ title: "Não salvou", description: "Só o administrador pode editar as mensagens.", variant: "destructive" });
    else toast({ title: "Mensagem salva" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Mensagens prontas</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Use {"{{nome}}"}, {"{{pedido}}"}, {"{{numeracoes}}"}, {"{{motivo}}"} e {"{{codigo}}"} — o sistema troca pelo dado da cliente.</p>
        {items.map((t, i) => (
          <div key={t.key} className="space-y-1">
            <div className="text-sm font-medium">{t.title}</div>
            <Textarea rows={3} value={t.body} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
            <Button size="sm" variant="outline" disabled={saving === t.key} onClick={() => save(t)}>Salvar</Button>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
