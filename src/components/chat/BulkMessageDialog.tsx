import { useState, useEffect } from "react";
import { Send, Loader2, Zap, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QuickReply {
  id: string;
  title: string;
  message: string;
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  components: any[];
}

export interface BulkRecipient {
  phone: string;
  whatsappNumberId: string | null;
}

interface BulkMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: BulkRecipient[];
  onDone?: () => void;
}

export function BulkMessageDialog({
  open,
  onOpenChange,
  recipients,
  onDone,
}: BulkMessageDialogProps) {
  const [tab, setTab] = useState("quick");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [selectedMessage, setSelectedMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedMessage("");
      setSelectedTemplate(null);
      setCustomMessage("");
      setProgress(0);
      setSent(0);
      setFailed(0);
      setIsSending(false);

      // Load quick replies
      supabase
        .from("quick_replies")
        .select("id, title, message")
        .order("sort_order")
        .order("title")
        .then(({ data }) => {
          if (data) setQuickReplies(data);
        });
    }
  }, [open]);

  const loadMetaTemplates = async () => {
    if (metaTemplates.length > 0) return;
    setLoadingTemplates(true);
    try {
      const firstNumberId = recipients[0]?.whatsappNumberId || null;
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsapp_number_id: firstNumberId },
      });
      if (!error && data?.templates) {
        setMetaTemplates(
          data.templates.filter((t: MetaTemplate) => t.status === "APPROVED")
        );
      }
    } catch {
      // ignore
    }
    setLoadingTemplates(false);
  };

  const messageToSend = tab === "quick" ? selectedMessage : (tab === "custom" ? customMessage : "");

  const handleSend = async () => {
    if (tab === "template" && selectedTemplate) {
      await sendTemplates();
      return;
    }

    const msg = messageToSend.trim();
    if (!msg || recipients.length === 0) return;

    setIsSending(true);
    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      try {
        const { error } = await supabase.functions.invoke("zapi-send-message", {
          body: { phone: r.phone, message: msg, whatsapp_number_id: r.whatsappNumberId },
        });

        if (error) throw error;

        await supabase.from("whatsapp_messages").insert({
          phone: r.phone,
          message: msg,
          direction: "outgoing",
          status: "sent",
          whatsapp_number_id: r.whatsappNumberId || null,
        });

        sentCount++;
      } catch {
        failCount++;
      }

      setSent(sentCount);
      setFailed(failCount);
      setProgress(((i + 1) / recipients.length) * 100);

      if (i < recipients.length - 1) await new Promise((res) => setTimeout(res, 200));
    }

    setIsSending(false);
    toast.success(`${sentCount} mensagem(ns) enviada(s)${failCount > 0 ? `, ${failCount} falha(s)` : ""}`);
    onDone?.();
    onOpenChange(false);
  };

  const sendTemplates = async () => {
    if (!selectedTemplate || recipients.length === 0) return;

    setIsSending(true);
    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      try {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send-template", {
          body: {
            phone: r.phone,
            template_name: selectedTemplate.name,
            language_code: selectedTemplate.language || "pt_BR",
            whatsapp_number_id: r.whatsappNumberId,
          },
        });

        if (error) throw error;
        sentCount++;
      } catch {
        failCount++;
      }

      setSent(sentCount);
      setFailed(failCount);
      setProgress(((i + 1) / recipients.length) * 100);

      if (i < recipients.length - 1) await new Promise((res) => setTimeout(res, 200));
    }

    setIsSending(false);
    toast.success(`${sentCount} template(s) enviado(s)${failCount > 0 ? `, ${failCount} falha(s)` : ""}`);
    onDone?.();
    onOpenChange(false);
  };

  const canSend =
    (tab === "quick" && selectedMessage.trim()) ||
    (tab === "custom" && customMessage.trim()) ||
    (tab === "template" && selectedTemplate);

  return (
    <Dialog open={open} onOpenChange={(v) => !isSending && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Send className="h-4 w-4" />
            Enviar para {recipients.length} conversa{recipients.length !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        {isSending ? (
          <div className="space-y-4 py-4">
            <Progress value={progress} className="h-2" />
            <div className="text-center text-sm text-muted-foreground">
              Enviando... {sent + failed}/{recipients.length}
              {failed > 0 && <span className="text-destructive ml-2">({failed} falha{failed !== 1 ? "s" : ""})</span>}
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v === "template") loadMetaTemplates(); }}>
            <TabsList className="grid w-full grid-cols-3 h-8">
              <TabsTrigger value="quick" className="text-xs gap-1">
                <Zap className="h-3 w-3" /> Rápidas
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-xs gap-1">
                <Send className="h-3 w-3" /> Livre
              </TabsTrigger>
              <TabsTrigger value="template" className="text-xs gap-1">
                <FileText className="h-3 w-3" /> Template
              </TabsTrigger>
            </TabsList>

            <TabsContent value="quick" className="mt-3">
              {quickReplies.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhuma mensagem rápida cadastrada.
                </p>
              ) : (
                <ScrollArea className="max-h-[220px]">
                  <div className="space-y-1">
                    {quickReplies.map((qr) => (
                      <div
                        key={qr.id}
                        className={`rounded-md px-3 py-2 cursor-pointer text-xs border ${
                          selectedMessage === qr.message
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-accent"
                        }`}
                        onClick={() => setSelectedMessage(qr.message)}
                      >
                        <div className="font-medium">{qr.title}</div>
                        <div className="text-muted-foreground line-clamp-2 mt-0.5">{qr.message}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="custom" className="mt-3">
              <Textarea
                placeholder="Digite a mensagem..."
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={5}
                className="text-xs"
              />
            </TabsContent>

            <TabsContent value="template" className="mt-3">
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : metaTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhum template aprovado encontrado.
                </p>
              ) : (
                <ScrollArea className="max-h-[220px]">
                  <div className="space-y-1">
                    {metaTemplates.map((t) => (
                      <div
                        key={t.name}
                        className={`rounded-md px-3 py-2 cursor-pointer text-xs border ${
                          selectedTemplate?.name === t.name
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-accent"
                        }`}
                        onClick={() => setSelectedTemplate(t)}
                      >
                        <div className="font-medium">{t.name}</div>
                        <div className="text-muted-foreground text-[10px]">{t.language}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        )}

        {!isSending && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSend} disabled={!canSend} className="gap-1">
              <Send className="h-3 w-3" />
              Enviar ({recipients.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
