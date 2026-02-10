import { useState, useEffect } from "react";
import { Plus, Loader2, Send, CheckCircle, Clock, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}

export function MetaTemplateCreator() {
  const { numbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<string>("");

  // Form state
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("MARKETING");
  const [language, setLanguage] = useState("pt_BR");
  const [headerType, setHeaderType] = useState<string>("none");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");

  useEffect(() => {
    if (numbers.length === 0) fetchNumbers();
  }, [numbers.length, fetchNumbers]);

  useEffect(() => {
    if (selectedNumberId && !selectedNumber) {
      setSelectedNumber(selectedNumberId);
    }
  }, [selectedNumberId, selectedNumber]);

  useEffect(() => {
    if (selectedNumber) fetchTemplates();
  }, [selectedNumber]);

  const fetchTemplates = async () => {
    if (!selectedNumber) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: null,
        method: "GET",
        headers: {},
      });

      // Use fetch directly since invoke doesn't support query params well
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates?whatsappNumberId=${selectedNumber}`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
        }
      );
      const result = await res.json();
      if (result.success) {
        setTemplates(result.templates || []);
      } else {
        toast.error("Erro ao buscar templates");
      }
    } catch (err) {
      console.error("Error fetching templates:", err);
      toast.error("Erro ao buscar templates");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !bodyText.trim()) {
      toast.error("Preencha o nome e o corpo da mensagem");
      return;
    }

    // Validate name format
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(name)) {
      toast.error("O nome deve conter apenas letras minúsculas, números e underscore, começando com letra");
      return;
    }

    setIsCreating(true);
    try {
      const components: Array<Record<string, unknown>> = [];

      if (headerType === "text" && headerText.trim()) {
        components.push({ type: "HEADER", format: "TEXT", text: headerText });
      }

      components.push({ type: "BODY", text: bodyText });

      if (footerText.trim()) {
        components.push({ type: "FOOTER", text: footerText });
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-create-template`,
        {
          method: "POST",
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            whatsappNumberId: selectedNumber,
            name,
            category,
            language,
            components,
          }),
        }
      );

      const result = await res.json();

      if (result.success) {
        toast.success("Template enviado para aprovação da Meta!");
        resetForm();
        setDialogOpen(false);
        fetchTemplates();
      } else {
        const errorMsg = result.details?.error?.message || "Erro ao criar template";
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error("Error creating template:", err);
      toast.error("Erro ao criar template");
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setName("");
    setCategory("MARKETING");
    setLanguage("pt_BR");
    setHeaderType("none");
    setHeaderText("");
    setBodyText("");
    setFooterText("");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return <Badge className="bg-stage-paid/20 text-stage-paid border-stage-paid/30 gap-1"><CheckCircle className="h-3 w-3" />Aprovado</Badge>;
      case "PENDING":
        return <Badge className="bg-stage-awaiting/20 text-stage-awaiting border-stage-awaiting/30 gap-1"><Clock className="h-3 w-3" />Pendente</Badge>;
      case "REJECTED":
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1"><XCircle className="h-3 w-3" />Rejeitado</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />{status}</Badge>;
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case "MARKETING": return "Marketing";
      case "UTILITY": return "Utilidade";
      case "AUTHENTICATION": return "Autenticação";
      default: return cat;
    }
  };

  const getBodyFromComponents = (components: MetaTemplate["components"]) => {
    const body = components.find(c => c.type === "BODY");
    return body?.text || "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">Templates da API Meta</h3>
          {numbers.length > 1 && (
            <Select value={selectedNumber} onValueChange={setSelectedNumber}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="Selecionar número" />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((num) => (
                  <SelectItem key={num.id} value={num.id}>
                    {num.label} - {num.phone_display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={fetchTemplates} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" className="gap-1" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Criar Template
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhum template encontrado
        </div>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm font-mono">{template.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {getStatusBadge(template.status)}
                      <Badge variant="outline" className="text-[10px]">
                        {getCategoryLabel(template.category)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{template.language}</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-wrap">
                  {getBodyFromComponents(template.components)}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Create Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Criar Template Meta
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nome do Template</Label>
                <Input
                  placeholder="ex: boas_vindas_cliente"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Apenas letras minúsculas, números e _</p>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Idioma</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cabeçalho</Label>
                <Select value={headerType} onValueChange={setHeaderType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem cabeçalho</SelectItem>
                    <SelectItem value="text">Texto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {headerType === "text" && (
              <div className="space-y-2">
                <Label>Texto do Cabeçalho</Label>
                <Input
                  placeholder="Ex: Olá, {{1}}!"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Use {"{{1}}"}, {"{{2}}"} etc. para variáveis
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Corpo da Mensagem *</Label>
              <Textarea
                placeholder="Ex: Olá {{1}}, seu pedido {{2}} está confirmado!"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={5}
              />
              <p className="text-[10px] text-muted-foreground">
                Use {"{{1}}"}, {"{{2}}"}, {"{{3}}"} para variáveis dinâmicas. Máximo 1024 caracteres.
              </p>
              <p className="text-[10px] text-muted-foreground text-right">{bodyText.length}/1024</p>
            </div>

            <div className="space-y-2">
              <Label>Rodapé (opcional)</Label>
              <Input
                placeholder="Ex: Obrigado pela preferência!"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
              />
            </div>

            {/* Preview */}
            {bodyText && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-[10px] font-medium text-muted-foreground mb-2">Preview:</p>
                {headerType === "text" && headerText && (
                  <p className="font-bold text-sm mb-1">{headerText}</p>
                )}
                <p className="text-sm whitespace-pre-wrap">{bodyText}</p>
                {footerText && (
                  <p className="text-xs text-muted-foreground mt-2">{footerText}</p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleCreate}
                disabled={isCreating || !name.trim() || !bodyText.trim()}
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar para Aprovação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
