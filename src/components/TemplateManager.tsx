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
import { Checkbox } from "@/components/ui/checkbox";
import { useTemplateStore, MessageTemplate } from "@/stores/templateStore";
import { STAGES, OrderStage } from "@/types/order";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TemplateManagerProps {
  trigger?: React.ReactNode;
}

export function TemplateManager({ trigger }: TemplateManagerProps) {
  const { templates, isLoading, fetchTemplates, addTemplate, updateTemplate, deleteTemplate, steps, fetchSteps, addStep, deleteStep } = useTemplateStore();
  const [newStepLabel, setNewStepLabel] = useState("");
  const [addingStep, setAddingStep] = useState(false);
  const stepOptions = [{ value: 0, label: "Nenhuma etapa", kind: null as string | null, sort_order: 0 }, ...steps];

  const handleAddStep = async () => {
    const label = newStepLabel.trim();
    if (!label) return;
    setAddingStep(true);
    try {
      const st = await addStep(label);
      setFunnelStep(st.value);
      setNewStepLabel("");
      toast.success("Etapa criada");
    } catch {
      toast.error("Erro ao criar etapa");
    } finally {
      setAddingStep(false);
    }
  };

  const handleDeleteStep = async (value: number) => {
    if (templates.some((t) => Number(t.funnel_step) === value)) {
      toast.error("Essa etapa tem mensagens. Mova ou exclua as mensagens antes.");
      return;
    }
    try {
      await deleteStep(value);
      if (funnelStep === value) setFunnelStep(0);
      toast.success("Etapa excluída");
    } catch {
      toast.error("Erro ao excluir etapa");
    }
  };
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [focusedVariant, setFocusedVariant] = useState(0);
  const [funnelStep, setFunnelStep] = useState(0);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  const message = variants[0] || "";
  const setVariantAt = (i: number, text: string) =>
    setVariants((prev) => prev.map((v, idx) => (idx === i ? text : v)));
  const appendToFocused = (token: string) =>
    setVariants((prev) => prev.map((v, idx) => (idx === focusedVariant ? v + token : v)));

  useEffect(() => {
    fetchTemplates();
    fetchSteps();
  }, [fetchTemplates, fetchSteps]);

  const handleEdit = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setName(template.name);
    setVariants(template.variants?.length ? template.variants : [template.message]);
    setFunnelStep(Number(template.funnel_step) || 0);
    setFocusedVariant(0);
    setSelectedStages(template.stage === 'all' ? [] : template.stage.split(','));
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
    setVariants([""]);
    setFunnelStep(0);
    setFocusedVariant(0);
    setSelectedStages([]);
    setEditingTemplate(null);
  };

  const handleSubmit = async () => {
    const cleanVariants = variants.map((v) => v.trim()).filter(Boolean);
    if (!name.trim() || cleanVariants.length === 0) {
      toast.error("Preencha nome e ao menos uma redação");
      return;
    }

    setIsSaving(true);
    const stageValue = selectedStages.length === 0 ? 'all' : selectedStages.join(',');
    const payload = {
      name,
      message: cleanVariants[0],
      stage: stageValue as any,
      funnel_step: funnelStep,
      variants: cleanVariants,
    };
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, payload);
        toast.success("Template atualizado");
      } else {
        await addTemplate(payload);
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

  const getStageBadges = (stageStr: string) => {
    if (stageStr === 'all') return [{ label: 'Todas as etapas', color: 'bg-muted' }];
    return stageStr.split(',').map(s => {
      const found = STAGES.find(st => st.id === s);
      return { label: found?.title || s, color: found?.color || 'bg-muted' };
    });
  };

  const dataVariables = [
    { name: '{{nome}}', desc: 'Primeiro nome da ficha do cliente (se não houver, usa o @)' },
    { name: '{{nome_completo}}', desc: 'Nome completo da ficha' },
    { name: '{{instagram}}', desc: 'Instagram com @' },
    { name: '{{whatsapp}}', desc: 'Número do WhatsApp' },
    { name: '{{link_carrinho}}', desc: 'Link do carrinho' },
    { name: '{{total}}', desc: 'Valor total do pedido' },
    { name: '{{total_pix}}', desc: 'Valor no Pix (5% de desconto)' },
    { name: '{{desconto_pix}}', desc: 'Quanto ela economiza no Pix' },
    { name: '{{parcelamento}}', desc: 'Ex.: até 10x de R$ 35,99 sem juros' },
    { name: '{{parcelas_max}}', desc: 'Número máximo de parcelas' },
    { name: '{{valor_parcela}}', desc: 'Valor de cada parcela' },
    { name: '{{produtos}}', desc: 'Lista de produtos' },
    { name: '{{produtos_curto}}', desc: 'Produtos em uma linha' },
  ];

  const emojiVariables = [
    { name: '{{emoji_ola}}', desc: 'Saudação (👋 🙋 ✌️)', preview: '👋' },
    { name: '{{emoji_feliz}}', desc: 'Feliz (😊 😄 🤗)', preview: '😊' },
    { name: '{{emoji_comemoracao}}', desc: 'Comemoração (🎉 🥳 ✨)', preview: '🎉' },
    { name: '{{emoji_amor}}', desc: 'Amor (❤️ 💕 🥰)', preview: '❤️' },
    { name: '{{emoji_ok}}', desc: 'Confirmação (👍 ✅ 👌)', preview: '👍' },
    { name: '{{emoji_dinheiro}}', desc: 'Dinheiro (💰 💵 🤑)', preview: '💰' },
    { name: '{{emoji_envio}}', desc: 'Envio (📦 🚚 ✈️)', preview: '📦' },
    { name: '{{emoji_urgente}}', desc: 'Urgente (⚡ 🔥 ⏰)', preview: '⚡' },
    { name: '{{emoji_agradecimento}}', desc: 'Agradecimento (🙏 💐 🌟)', preview: '🙏' },
    { name: '{{emoji_triste}}', desc: 'Triste (😢 😔 🥺)', preview: '😢' },
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
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Number(template.funnel_step) > 0 && (
                          <Badge variant="outline" className="text-xs border-primary text-primary">
                            {steps.find((s) => s.value === Number(template.funnel_step))?.label || `Etapa ${template.funnel_step}`}
                            {" · "}{template.variants?.length || 1} redação(ões)
                          </Badge>
                        )}
                        {getStageBadges(template.stage).map((b, i) => (
                          <Badge key={i} variant="secondary" className={cn("text-xs", b.color, "text-white")}>
                            {b.label}
                          </Badge>
                        ))}
                      </div>
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
                <Label>Etapa do Funil</Label>
                <p className="text-xs text-muted-foreground">
                  {selectedStages.length === 0 ? "Nenhuma selecionada = Todas as etapas" : `${selectedStages.length} etapa(s) selecionada(s)`}
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-auto border rounded-lg p-3">
                  {STAGES.map((s) => {
                    const checked = selectedStages.includes(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-1 py-0.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            if (v) {
                              setSelectedStages(prev => [...prev, s.id]);
                            } else {
                              setSelectedStages(prev => prev.filter(x => x !== s.id));
                            }
                          }}
                        />
                        <span className={cn("w-2 h-2 rounded-full shrink-0", s.color)} />
                        <span className="truncate">{s.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Etapa do atendimento (rodízio)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {stepOptions.map((s) => (
                    <div key={s.value} className="relative">
                      <Button
                        type="button"
                        variant={funnelStep === s.value ? "default" : "outline"}
                        size="sm"
                        className="w-full justify-start text-xs h-auto py-2 whitespace-normal text-left"
                        onClick={() => setFunnelStep(s.value)}
                      >
                        {s.label}
                      </Button>
                      {s.value > 4 && !s.kind && (
                        <button
                          type="button"
                          title="Excluir etapa"
                          className="absolute -top-1.5 -right-1.5 rounded-full bg-background border p-0.5 text-destructive"
                          onClick={() => handleDeleteStep(s.value)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nova etapa (ex.: Pós-venda)"
                    value={newStepLabel}
                    onChange={(e) => setNewStepLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddStep(); } }}
                    className="h-8 text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={handleAddStep} disabled={addingStep || !newStepLabel.trim()}>
                    {addingStep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Criar etapa
                  </Button>
                </div>
                {steps.find((st) => st.value === funnelStep)?.kind === "payment_link" && (
                  <p className="text-xs rounded-md border border-primary/40 bg-primary/5 p-2">
                    Estas redações são usadas pelo botão <b>Enviar link Pagamento</b> da Live, em rodízio.
                    Use <b>{"{member_area_link}"}</b> (área de membros já logada) ou <b>{"{checkout_link}"}</b> para o link,
                    e <b>{"{{nome}}"}</b>, <b>{"{instagram}"}</b>, <b>{"{total}"}</b>, <b>{"{products}"}</b>.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Mensagens da mesma etapa entram no rodízio: a cada envio o sistema usa
                  uma redação diferente, reduzindo o risco de bloqueio.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Redações (variações)</Label>
                {variants.map((v, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Redação {i + 1}{i === 0 ? " (principal)" : ""}
                      </span>
                      {variants.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <Textarea
                      placeholder="Digite sua mensagem..."
                      value={v}
                      onFocus={() => setFocusedVariant(i)}
                      onChange={(e) => setVariantAt(i, e.target.value)}
                      rows={4}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setVariants((prev) => [...prev, ""])}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar redação
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Variáveis de dados:</Label>
                  <div className="flex flex-wrap gap-1">
                    {dataVariables.map((v) => (
                      <Badge
                        key={v.name}
                        variant="outline"
                        className="text-xs cursor-pointer hover:bg-secondary"
                        onClick={() => appendToFocused(v.name)}
                        title={v.desc}
                      >
                        {v.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    🎲 Emojis automáticos (variam a cada envio):
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {emojiVariables.map((v) => (
                      <Badge
                        key={v.name}
                        variant="secondary"
                        className="text-xs cursor-pointer hover:bg-primary/20 gap-1"
                        onClick={() => appendToFocused(v.name)}
                        title={v.desc}
                      >
                        <span>{v.preview}</span>
                        <span className="opacity-70">{v.name.replace(/\{\{|\}\}/g, '')}</span>
                      </Badge>
                    ))}
                  </div>
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
