import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTemplateStore, MessageTemplate } from "@/stores/templateStore";
import { STAGES, OrderStage } from "@/types/order";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TemplateManagerProps {
  trigger?: React.ReactNode;
}

export function TemplateManager({ trigger }: TemplateManagerProps) {
  const { templates, isLoading, fetchTemplates, addTemplate, updateTemplate, deleteTemplate } = useTemplateStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<OrderStage | 'all'>('all');

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleEdit = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setName(template.name);
    setMessage(template.message);
    setStage(template.stage);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id);
      toast.success("Template excluído");
    } catch {
      toast.error("Erro ao excluir template");
    }
  };

  const resetForm = () => {
    setName("");
    setMessage("");
    setStage('all');
    setEditingTemplate(null);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !message.trim()) {
      toast.error("Preencha nome e mensagem");
      return;
    }

    setIsSaving(true);
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, { name, message, stage });
        toast.success("Template atualizado");
      } else {
        await addTemplate({ name, message, stage });
        toast.success("Template criado");
      }
      resetForm();
      setIsEditing(false);
    } catch {
      toast.error("Erro ao salvar template");
    } finally {
      setIsSaving(false);
    }
  };

  const getStageLabel = (stageId: OrderStage | 'all') => {
    if (stageId === 'all') return 'Todas as etapas';
    return STAGES.find(s => s.id === stageId)?.title || stageId;
  };

  const getStageColor = (stageId: OrderStage | 'all') => {
    if (stageId === 'all') return 'bg-muted';
    return STAGES.find(s => s.id === stageId)?.color || 'bg-muted';
  };

  const variables = [
    { name: '{{nome}}', desc: 'Nome do cliente (Instagram sem @)' },
    { name: '{{instagram}}', desc: 'Instagram com @' },
    { name: '{{whatsapp}}', desc: 'Número do WhatsApp' },
    { name: '{{link_carrinho}}', desc: 'Link do carrinho' },
    { name: '{{total}}', desc: 'Valor total do pedido' },
    { name: '{{produtos}}', desc: 'Lista de produtos' },
  ];

  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <FileText className="h-4 w-4" />
            Mensagens Prontas
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Mensagens Prontas
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col gap-4 mt-4 overflow-hidden">
          <Button
            onClick={() => {
              resetForm();
              setIsEditing(true);
            }}
            className="w-full gap-2"
          >
            <Plus className="h-4 w-4" />
            Nova Mensagem
          </Button>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
            <div className="space-y-3 pr-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{template.name}</p>
                      <Badge
                        variant="secondary"
                        className={cn("text-xs mt-1", getStageColor(template.stage), "text-white")}
                      >
                        {getStageLabel(template.stage)}
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleEdit(template)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(template.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {template.message}
                  </p>
                </div>
              ))}
            </div>
            )}
          </ScrollArea>
        </div>

        {/* Edit/Create Dialog */}
        <Dialog open={isEditing} onOpenChange={setIsEditing}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? "Editar Mensagem" : "Nova Mensagem"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Nome do Template</Label>
                <Input
                  id="template-name"
                  placeholder="Ex: Boas-vindas"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-stage">Etapa do Funil</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as OrderStage | 'all')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as etapas</SelectItem>
                    {STAGES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-message">Mensagem</Label>
                <Textarea
                  id="template-message"
                  placeholder="Digite sua mensagem..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Variáveis disponíveis:</Label>
                <div className="flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <Badge
                      key={v.name}
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-secondary"
                      onClick={() => setMessage((prev) => prev + v.name)}
                      title={v.desc}
                    >
                      {v.name}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsEditing(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleSubmit} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingTemplate ? "Salvar" : "Criar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
