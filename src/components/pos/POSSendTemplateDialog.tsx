import { useState, useEffect } from "react";
import { FileText, Send, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  customerName?: string;
  whatsappNumberId: string | null;
  onSent?: () => void;
}

export function POSSendTemplateDialog({ open, onOpenChange, phone, customerName, whatsappNumberId, onSent }: Props) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && templates.length === 0) {
      loadTemplates();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedTemplate(null);
      setTemplateVars({});
      setSearch("");
    }
  }, [open]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId, status: "APPROVED" },
      });
      if (data?.templates) {
        setTemplates(data.templates.filter((t: MetaTemplate) => t.status === "APPROVED"));
      }
    } catch (e) {
      console.error("Error loading templates:", e);
    } finally {
      setLoading(false);
    }
  };

  const extractVars = (template: MetaTemplate): string[] => {
    const vars: string[] = [];
    for (const comp of template.components) {
      const matches = (comp.text || "").match(/\{\{(\d+)\}\}/g) || [];
      for (const m of matches) {
        if (!vars.includes(m)) vars.push(m);
      }
    }
    return vars.sort();
  };

  const getPreview = (template: MetaTemplate): string => {
    let preview = "";
    for (const comp of template.components) {
      if (comp.type === "BODY" && comp.text) { preview = comp.text; break; }
    }
    Object.entries(templateVars).forEach(([key, value]) => {
      if (value) preview = preview.replace(key, value);
    });
    return preview;
  };

  const handleSelect = (template: MetaTemplate) => {
    setSelectedTemplate(template);
    const vars = extractVars(template);
    const initial: Record<string, string> = {};
    for (const v of vars) {
      // Auto-fill {{1}} with customer name if available
      if (v === "{{1}}" && customerName) initial[v] = customerName;
      else initial[v] = "";
    }
    setTemplateVars(initial);
  };

  const handleSend = async () => {
    if (!selectedTemplate || !phone) return;
    const cleanPhone = phone.replace(/\D/g, "");
    setSending(true);
    try {
      const parameters = extractVars(selectedTemplate).map(v => ({
        type: "text",
        text: templateVars[v] || "",
      }));

      await supabase.functions.invoke("meta-whatsapp-send-template", {
        body: {
          phone: cleanPhone,
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          components: parameters.length > 0 ? [{ type: "body", parameters }] : [],
          whatsappNumberId,
        },
      });

      const previewText = `[Template: ${selectedTemplate.name}] ${getPreview(selectedTemplate)}`;
      await supabase.from("whatsapp_messages").insert({
        phone: cleanPhone,
        message: previewText,
        direction: "outgoing",
        status: "sent",
        whatsapp_number_id: whatsappNumberId,
      });

      toast.success("Template enviado!");
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error sending template:", error);
      toast.error("Erro ao enviar template");
    } finally {
      setSending(false);
    }
  };

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-[#00a884]" />
            Enviar Template Meta
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 pb-4 space-y-3">
            {!selectedTemplate ? (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar template..."
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {filtered.map(t => (
                      <button
                        key={t.name}
                        onClick={() => handleSelect(t)}
                        className="w-full text-left p-2 rounded-lg border border-border hover:border-[#00a884]/50 hover:bg-[#00a884]/5 transition-all"
                      >
                        <p className="text-xs font-medium">{t.name}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">
                          {t.components.find((c: any) => c.type === "BODY")?.text || ""}
                        </p>
                        <div className="flex gap-1 mt-1">
                          <Badge variant="secondary" className="text-[9px]">{t.language}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{t.category}</Badge>
                        </div>
                      </button>
                    ))}
                    {filtered.length === 0 && !loading && (
                      <p className="text-xs text-muted-foreground text-center py-6">Nenhum template encontrado</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{selectedTemplate.name}</p>
                    <Badge variant="secondary" className="text-[9px] mt-0.5">{selectedTemplate.language}</Badge>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSelectedTemplate(null); setTemplateVars({}); }}>
                    Trocar
                  </Button>
                </div>

                {/* Preview */}
                <div className="p-3 rounded-lg bg-[#dcf8c6] dark:bg-[#005c4b] text-xs whitespace-pre-wrap">
                  {getPreview(selectedTemplate)}
                </div>

                {/* Variables */}
                {extractVars(selectedTemplate).length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Variáveis</Label>
                    {extractVars(selectedTemplate).map(v => (
                      <div key={v} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] shrink-0">{v}</Badge>
                        <Input
                          value={templateVars[v] || ""}
                          onChange={e => setTemplateVars(prev => ({ ...prev, [v]: e.target.value }))}
                          className="h-7 text-xs flex-1"
                          placeholder={`Valor para ${v}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {selectedTemplate && (
          <div className="px-4 py-3 border-t flex justify-end">
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending}
              className="bg-[#00a884] hover:bg-[#00a884]/90 gap-1.5"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Enviar Template
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
