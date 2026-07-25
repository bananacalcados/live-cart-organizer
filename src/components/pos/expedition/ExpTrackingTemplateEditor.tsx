import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Save, Trash2, MessageSquareText } from "lucide-react";
import { TRACKING_VARS, TrackingVarValues, renderTrackingMessage } from "@/lib/pos/trackingMessage";

export interface TrackingTemplate {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Valores reais do pedido para a pré-visualização. */
  previewValues: TrackingVarValues;
  /** Template atualmente selecionado na conferência. */
  selectedId?: string;
  onSaved: (templates: TrackingTemplate[], activeId: string) => void;
}

/**
 * Editor/criador das mensagens de rastreio, usado dentro do modal de Conferência.
 * Permite escolher, editar, criar e excluir mensagens, inserindo variáveis do sistema.
 */
export function ExpTrackingTemplateEditor({ open, onOpenChange, previewValues, selectedId, onSaved }: Props) {
  const [templates, setTemplates] = useState<TrackingTemplate[]>([]);
  const [currentId, setCurrentId] = useState<string>("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const load = async (focusId?: string) => {
    const { data } = await supabase
      .from("pos_tracking_templates" as any)
      .select("id, name, body, is_default")
      .order("is_default", { ascending: false })
      .order("name");
    const list = ((data as any[]) || []) as TrackingTemplate[];
    setTemplates(list);
    const pick = list.find((t) => t.id === (focusId || selectedId)) || list[0];
    if (pick) {
      setCurrentId(pick.id);
      setName(pick.name);
      setBody(pick.body);
    } else {
      setCurrentId("");
      setName("");
      setBody("");
    }
    return list;
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setCurrentId(id);
    setName(t.name);
    setBody(t.body);
  };

  const insertVar = (key: string) => {
    const token = `{{${key}}}`;
    const el = areaRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Dê um nome para a mensagem");
    if (!body.trim()) return toast.error("Escreva o corpo da mensagem");
    setSaving(true);
    try {
      let id = currentId;
      if (id) {
        const { error } = await supabase
          .from("pos_tracking_templates" as any)
          .update({ name: name.trim(), body })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("pos_tracking_templates" as any)
          .insert({ name: name.trim(), body } as any)
          .select("id")
          .single();
        if (error) throw error;
        id = (data as any).id;
      }
      const list = await load(id);
      onSaved(list, id);
      toast.success("Mensagem salva");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar mensagem");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("pos_tracking_templates" as any).delete().eq("id", currentId);
      if (error) throw error;
      const list = await load();
      onSaved(list, list[0]?.id || "");
      toast.success("Mensagem excluída");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao excluir");
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setCurrentId("");
    setName("");
    setBody("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-exp-check" /> Mensagens de rastreio
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <Label className="text-base font-bold">Mensagem</Label>
              <Select value={currentId} onValueChange={pickTemplate}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Nova mensagem" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-base">
                      {t.name}
                      {t.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-12 font-bold" onClick={startNew}>
                <Plus className="h-4 w-4 mr-1" /> Nova
              </Button>
              {!!currentId && (
                <Button variant="outline" className="h-12 font-bold text-destructive" onClick={remove} disabled={saving}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div>
            <Label className="text-base font-bold">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-base" placeholder="Ex: Rastreio padrão" />
          </div>

          <div>
            <Label className="text-base font-bold">Variáveis (clique para inserir)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {TRACKING_VARS.map((v) => (
                <Badge
                  key={v.key}
                  onClick={() => insertVar(v.key)}
                  className="cursor-pointer text-sm font-bold"
                  variant="secondary"
                >
                  {v.label}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-base font-bold">Corpo da mensagem</Label>
            <Textarea
              ref={areaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="text-base"
              placeholder="Escreva a mensagem usando as variáveis acima"
            />
          </div>

          <div className="rounded-xl border-2 border-dashed p-3">
            <p className="text-sm font-black mb-1">Pré-visualização com os dados deste pedido</p>
            <p className="text-base whitespace-pre-wrap">{renderTrackingMessage(body, previewValues) || "—"}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button onClick={save} disabled={saving} className="font-black bg-exp-check text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              SALVAR MENSAGEM
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpTrackingTemplateEditor;
