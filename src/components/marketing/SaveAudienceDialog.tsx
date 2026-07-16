import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Save } from "lucide-react";
import { AudienceFilter, cleanAudienceFilter } from "@/components/pos/audience/AudienceFilterBuilder";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filter: AudienceFilter;
  /** Lista de filtros da UI que NÃO cabem no formato reutilizável (aviso ao usuário). */
  ignoredFilters?: string[];
  defaultName?: string;
  onSaved?: (id: string) => void;
}

export function SaveAudienceDialog({
  open, onOpenChange, filter, ignoredFilters = [], defaultName = "", onSaved,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao público");
      return;
    }
    setSaving(true);
    const payload = {
      nome: name.trim(),
      filtro_json: cleanAudienceFilter(filter) as unknown as never,
    };
    const { data, error } = await supabase
      .from("campanha_publicos")
      .insert(payload)
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Público salvo e disponível em PDV > Automação e Disparos");
    onOpenChange(false);
    setName("");
    onSaved?.(data.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar filtros como público</DialogTitle>
          <DialogDescription>
            Fica disponível em PDV → Online → Automação, Marketing → Disparos e Matriz RFM.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-600">Nome do público</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Tamanho 36 em GV inativos 60d"
              autoFocus
            />
          </div>
          {ignoredFilters.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              Os filtros a seguir não são suportados no formato reutilizável e ficarão de fora:
              <strong className="ml-1">{ignoredFilters.join(", ")}</strong>.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar público
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
