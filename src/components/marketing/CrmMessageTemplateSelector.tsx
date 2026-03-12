import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, FileText, Loader2, Save, Copy } from "lucide-react";
import { toast } from "sonner";

export interface CrmTemplate {
  id: string;
  name: string;
  message: string;
  created_at: string;
  updated_at: string;
}

interface CrmMessageTemplateSelectorProps {
  onSelect: (message: string) => void;
  variables: Record<string, string>;
}

const VARIABLE_LIST = [
  { key: "{{nome}}", desc: "Nome completo do cliente" },
  { key: "{{primeiro_nome}}", desc: "Primeiro nome" },
  { key: "{{telefone}}", desc: "Telefone do cliente" },
  { key: "{{email}}", desc: "Email do cliente" },
  { key: "{{ultima_compra}}", desc: "Data da última compra" },
  { key: "{{total_gasto}}", desc: "Total já gasto" },
  { key: "{{ticket_medio}}", desc: "Ticket médio" },
  { key: "{{total_pedidos}}", desc: "Quantidade de pedidos" },
  { key: "{{segmento}}", desc: "Segmento RFM" },
  { key: "{{vendedora}}", desc: "Vendedora do último atendimento" },
  { key: "{{ultimo_produto}}", desc: "Último produto comprado" },
];

function applyVariables(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "gi"), value || "");
  }
  return result;
}

export function CrmMessageTemplateSelector({ onSelect, variables }: CrmMessageTemplateSelectorProps) {
  const [templates, setTemplates] = useState<CrmTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<CrmTemplate | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("crm_message_templates")
      .select("*")
      .order("created_at", { ascending: true });
    setTemplates((data as CrmTemplate[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSave = async () => {
    if (!name.trim() || !message.trim()) { toast.error("Preencha nome e mensagem"); return; }
    setSaving(true);
    try {
      if (editTemplate) {
        await supabase.from("crm_message_templates").update({ name, message } as any).eq("id", editTemplate.id);
        toast.success("Template atualizado");
      } else {
        await supabase.from("crm_message_templates").insert({ name, message } as any);
        toast.success("Template criado");
      }
      setEditOpen(false);
      setEditTemplate(null);
      setName("");
      setMessage("");
      fetchTemplates();
    } catch { toast.error("Erro ao salvar"); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("crm_message_templates").delete().eq("id", id);
    toast.success("Template excluído");
    fetchTemplates();
  };

  const handleUse = (tpl: CrmTemplate) => {
    const applied = applyVariables(tpl.message, variables);
    onSelect(applied);
    toast.success("Mensagem preenchida com dados do cliente");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <FileText className="h-4 w-4" />Modelos de Mensagem
        </p>
        <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => {
          setEditTemplate(null); setName(""); setMessage(""); setEditOpen(true);
        }}>
          <Plus className="h-3 w-3" />Novo
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">Nenhum modelo salvo ainda</p>
      ) : (
        <ScrollArea className="max-h-[160px]">
          <div className="space-y-1.5">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors group">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleUse(tpl)}>
                  <p className="text-xs font-medium truncate">{tpl.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{tpl.message.slice(0, 80)}...</p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUse(tpl)} title="Usar">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                    setEditTemplate(tpl); setName(tpl.name); setMessage(tpl.message); setEditOpen(true);
                  }} title="Editar">
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(tpl.id)} title="Excluir">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Editar Modelo" : "Novo Modelo de Mensagem"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input placeholder="Ex: Reativação de cliente" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mensagem</Label>
              <Textarea placeholder="Olá {{primeiro_nome}}, sentimos sua falta!" value={message} onChange={e => setMessage(e.target.value)} rows={5} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Variáveis disponíveis (clique para inserir):</Label>
              <div className="flex flex-wrap gap-1">
                {VARIABLE_LIST.map(v => (
                  <Badge key={v.key} variant="outline" className="text-[10px] cursor-pointer hover:bg-secondary"
                    onClick={() => setMessage(prev => prev + v.key)} title={v.desc}>
                    {v.key}
                  </Badge>
                ))}
              </div>
            </div>

            {message && (
              <div className="space-y-1 border-t pt-2">
                <Label className="text-[10px] text-muted-foreground">Pré-visualização:</Label>
                <div className="p-2 rounded bg-muted/50 text-xs whitespace-pre-wrap">
                  {applyVariables(message, variables)}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button className="flex-1 gap-1" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editTemplate ? "Salvar" : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
