import { useState, useEffect, useRef } from "react";
import { Send, X, Loader2, MessageCircle, Phone, Image, Video, Mic, MicOff, Paperclip, FileText, Check, CheckCheck, AlertCircle, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { useZapi } from "@/hooks/useZapi";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { MessageStatusIcon } from "@/components/chat/MessageStatusIcon";
import { WhatsAppMediaAttachment } from "@/components/chat/WhatsAppMediaAttachment";

interface LiveWhatsAppChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerName: string;
  viewerPhone: string;
  cartSummary?: string;
}

interface WaMessage {
  id: string;
  phone: string;
  message: string;
  direction: "incoming" | "outgoing";
  status: string;
  media_type?: string;
  media_url?: string;
  created_at: string;
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

export function LiveWhatsAppChatDialog({ open, onOpenChange, viewerName, viewerPhone, cartSummary }: LiveWhatsAppChatDialogProps) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sendMessage: zapiSendMessage } = useZapi();
  const { fetchNumbers, getSelectedNumber } = useWhatsAppNumberStore();

  // Media state
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Meta templates state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      fetchNumbers();
      loadMessages();
    }
  }, [open, viewerPhone]);

  // Realtime subscription (INSERT + UPDATE for status changes)
  useEffect(() => {
    if (!open || !viewerPhone) return;
    const channel = supabase
      .channel(`live-wa-chat-${viewerPhone}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
        filter: `phone=eq.${viewerPhone}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as WaMessage]);
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_messages",
        filter: `phone=eq.${viewerPhone}`,
      }, (payload) => {
        const updated = payload.new as WaMessage;
        setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, viewerPhone]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", viewerPhone)
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages((data as WaMessage[]) || []);
    setLoading(false);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;
    const text = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      const selectedNum = getSelectedNumber();
      if (selectedNum?.provider === "meta") {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: viewerPhone, message: text, whatsappNumberId: selectedNum.id },
        });
        if (error) throw error;
      } else {
        const result = await zapiSendMessage(viewerPhone, text);
        if (!result.success) throw new Error(result.error);
      }
      await supabase.from("whatsapp_messages").insert({
        phone: viewerPhone,
        message: text,
        direction: "outgoing",
        status: "sent",
        whatsapp_number_id: getSelectedNumber()?.provider === "meta" ? getSelectedNumber()?.id : null,
      });
      toast.success("Mensagem enviada!");
    } catch (err: any) {
      console.error("Error sending:", err);
      toast.error("Erro ao enviar mensagem");
      setNewMessage(text);
    } finally {
      setIsSending(false);
    }
  };

  // ── Media sending ──
  const handleMediaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    if (file.size > 16 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 16MB.");
      return;
    }

    setIsUploadingMedia(true);
    try {
      const publicUrl = await uploadMediaToStorage(file);
      if (!publicUrl) throw new Error("Upload falhou");

      let mediaType: "image" | "video" | "audio" | "document" = "document";
      if (file.type.startsWith("image/")) mediaType = "image";
      else if (file.type.startsWith("video/")) mediaType = "video";
      else if (file.type.startsWith("audio/")) mediaType = "audio";

      const selectedNum = getSelectedNumber();
      if (selectedNum?.provider === "meta") {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: viewerPhone, message: "", type: mediaType, mediaUrl: publicUrl, whatsappNumberId: selectedNum.id },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke("zapi-send-media", {
          body: { phone: viewerPhone, mediaUrl: publicUrl, mediaType, caption: "", whatsapp_number_id: selectedNum?.id },
        });
        if (error) throw error;
      }

      await supabase.from("whatsapp_messages").insert({
        phone: viewerPhone,
        message: mediaType === "image" ? "📷 Imagem" : mediaType === "video" ? "🎥 Vídeo" : mediaType === "audio" ? "🎤 Áudio" : "📎 Documento",
        direction: "outgoing",
        status: "sent",
        media_type: mediaType,
        media_url: publicUrl,
        whatsapp_number_id: selectedNum?.id || null,
      });
      toast.success(`${mediaType === "image" ? "Imagem" : mediaType === "video" ? "Vídeo" : "Arquivo"} enviado!`);
    } catch (err: any) {
      console.error("Error sending media:", err);
      toast.error("Erro ao enviar mídia");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // ── Audio recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size === 0) return;

        setIsUploadingMedia(true);
        try {
          const file = new File([audioBlob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
          const publicUrl = await uploadMediaToStorage(file);
          if (!publicUrl) throw new Error("Upload falhou");

          const selectedNum = getSelectedNumber();
          if (selectedNum?.provider === "meta") {
            const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
              body: { phone: viewerPhone, message: "", type: "audio", mediaUrl: publicUrl, whatsappNumberId: selectedNum.id },
            });
            if (error) throw error;
          } else {
            const { error } = await supabase.functions.invoke("zapi-send-media", {
              body: { phone: viewerPhone, mediaUrl: publicUrl, mediaType: "audio", caption: "", whatsapp_number_id: selectedNum?.id },
            });
            if (error) throw error;
          }

          await supabase.from("whatsapp_messages").insert({
            phone: viewerPhone,
            message: "🎤 Áudio",
            direction: "outgoing",
            status: "sent",
            media_type: "audio",
            media_url: publicUrl,
            whatsapp_number_id: selectedNum?.id || null,
          });
          toast.success("Áudio enviado!");
        } catch (err: any) {
          console.error("Error sending audio:", err);
          toast.error("Erro ao enviar áudio");
        } finally {
          setIsUploadingMedia(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone error:", err);
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  // ── Meta Templates ──
  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const selectedNum = getSelectedNumber();
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: selectedNum?.id },
      });
      if (error) throw error;
      const approved = (data?.templates || []).filter((t: MetaTemplate) => t.status === "APPROVED");
      setTemplates(approved);
    } catch (err) {
      console.error("Error loading templates:", err);
      toast.error("Erro ao carregar templates");
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Extract variable placeholders from template components
  const getTemplateVariables = (template: MetaTemplate): { key: string; label: string }[] => {
    const vars: { key: string; label: string }[] = [];
    for (const comp of template.components || []) {
      if (comp.type === "BODY" && comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g) || [];
        matches.forEach((m: string) => {
          const num = m.replace(/[{}]/g, "");
          if (!vars.find(v => v.key === num)) {
            vars.push({ key: num, label: `Variável {{${num}}}` });
          }
        });
      }
      if (comp.type === "HEADER" && comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g) || [];
        matches.forEach((m: string) => {
          const num = m.replace(/[{}]/g, "");
          const headerKey = `header_${num}`;
          if (!vars.find(v => v.key === headerKey)) {
            vars.push({ key: headerKey, label: `Header {{${num}}}` });
          }
        });
      }
    }
    return vars;
  };

  const selectTemplate = (template: MetaTemplate) => {
    setSelectedTemplate(template);
    setTemplateVars({});
  };

  const getRenderedPreview = (template: MetaTemplate, vars: Record<string, string>): string => {
    let text = "";
    for (const comp of template.components || []) {
      if (comp.type === "BODY" && comp.text) {
        text = comp.text;
        Object.entries(vars).forEach(([key, val]) => {
          if (!key.startsWith("header_")) {
            text = text.replace(`{{${key}}}`, val || `{{${key}}}`);
          }
        });
      }
    }
    return text;
  };

  const sendTemplate = async (template: MetaTemplate) => {
    setSendingTemplate(template.name);
    try {
      const selectedNum = getSelectedNumber();
      // Build components array with filled variables
      const components: any[] = [];
      const bodyVars = Object.entries(templateVars).filter(([k]) => !k.startsWith("header_"));
      const headerVars = Object.entries(templateVars).filter(([k]) => k.startsWith("header_"));
      
      if (bodyVars.length > 0) {
        components.push({
          type: "body",
          parameters: bodyVars
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([, val]) => ({ type: "text", text: val || "" })),
        });
      }
      if (headerVars.length > 0) {
        const headerComp = template.components?.find((c: any) => c.type === "HEADER");
        if (headerComp?.format === "TEXT") {
          components.push({
            type: "header",
            parameters: headerVars
              .sort(([a], [b]) => parseInt(a.replace("header_", "")) - parseInt(b.replace("header_", "")))
              .map(([, val]) => ({ type: "text", text: val || "" })),
          });
        }
      }

      const renderedMessage = getRenderedPreview(template, templateVars);

      const { error } = await supabase.functions.invoke("meta-whatsapp-send-template", {
        body: {
          phone: viewerPhone,
          templateName: template.name,
          language: template.language,
          whatsappNumberId: selectedNum?.id,
          components: components.length > 0 ? components : undefined,
          renderedMessage,
        },
      });
      if (error) throw error;

      toast.success(`Template "${template.name}" enviado!`);
      setShowTemplates(false);
      setSelectedTemplate(null);
      setTemplateVars({});
    } catch (err: any) {
      console.error("Error sending template:", err);
      toast.error("Erro ao enviar template");
    } finally {
      setSendingTemplate(null);
    }
  };

  const renderMessageStatus = (msg: WaMessage) => {
    if (msg.direction !== "outgoing") return null;
    return <MessageStatusIcon status={msg.status} className="h-3 w-3 inline-block ml-1" />;
  };

  const formatTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  const formatRecordingTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[650px] p-0 overflow-hidden gap-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#008069] text-white flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{viewerName}</p>
            <p className="text-xs text-white/70">{viewerPhone}</p>
          </div>
          <a
            href={`https://wa.me/${viewerPhone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-white/80 hover:text-white hover:bg-white/10"
            title="Abrir no WhatsApp"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-white/80 hover:text-white hover:bg-white/10 gap-1"
            onClick={() => { setShowTemplates(!showTemplates); if (!showTemplates && templates.length === 0) loadTemplates(); }}
          >
            <FileText className="h-3.5 w-3.5" />
            Templates
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Cart summary */}
        {cartSummary && (
          <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b text-xs text-amber-700 dark:text-amber-400 flex-shrink-0">
            🛒 {cartSummary}
          </div>
        )}

        {/* Number selector */}
        <div className="px-3 py-1.5 border-b flex-shrink-0">
          <WhatsAppNumberSelector className="h-8 text-xs" />
        </div>

        {/* Templates panel */}
        {showTemplates && (
          <div className="px-3 py-2 border-b bg-muted/30 max-h-[250px] overflow-y-auto flex-shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Templates Meta aprovados</p>
            {loadingTemplates ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : selectedTemplate ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-xs">{selectedTemplate.name}</p>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setSelectedTemplate(null); setTemplateVars({}); }}>
                    ← Voltar
                  </Button>
                </div>
                {/* Preview */}
                <div className="bg-[#d9fdd3] dark:bg-[#005c4b] rounded-lg p-2 text-[11px] whitespace-pre-wrap">
                  {getRenderedPreview(selectedTemplate, templateVars) || "(Sem corpo de texto)"}
                </div>
                {/* Variable inputs */}
                {getTemplateVariables(selectedTemplate).length > 0 && (
                  <div className="space-y-1.5">
                    {getTemplateVariables(selectedTemplate).map(v => (
                      <div key={v.key} className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground w-20 shrink-0">{v.label}</label>
                        <Input
                          className="h-7 text-xs"
                          placeholder={`Valor para ${v.label}`}
                          value={templateVars[v.key] || ""}
                          onChange={e => setTemplateVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  disabled={sendingTemplate === selectedTemplate.name}
                  onClick={() => sendTemplate(selectedTemplate)}
                >
                  {sendingTemplate === selectedTemplate.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Enviar Template
                </Button>
              </div>
            ) : templates.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Nenhum template aprovado encontrado</p>
            ) : (
              <div className="space-y-1">
                {templates.map(t => {
                  const vars = getTemplateVariables(t);
                  return (
                    <div key={t.name} className="flex items-center justify-between p-2 rounded-lg bg-background border text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{t.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {t.category} • {t.language}
                          {vars.length > 0 && ` • ${vars.length} var`}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 ml-2"
                        onClick={() => vars.length > 0 ? selectTemplate(t) : sendTemplate(t)}
                        disabled={sendingTemplate === t.name}
                      >
                        {sendingTemplate === t.name ? <Loader2 className="h-3 w-3 animate-spin" /> : vars.length > 0 ? <FileText className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                        {vars.length > 0 ? "Configurar" : "Enviar"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-[#efeae2] dark:bg-[#0b141a]" style={{ backgroundImage: "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiB4PSIwIiB5PSIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJwIj48Y2lyY2xlIGN4PSIyIiBjeT0iMiIgcj0iMC41IiBmaWxsPSJyZ2JhKDAsMCwwLDAuMDMpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI3ApIi8+PC9zdmc+')" }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MessageCircle className="h-8 w-8 opacity-40" />
              <p className="text-xs">Nenhuma conversa anterior</p>
              <p className="text-[10px]">Envie a primeira mensagem!</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${
                  msg.direction === "outgoing"
                    ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-foreground"
                    : "bg-white dark:bg-[#202c33] text-foreground"
                }`}>
                  <WhatsAppMediaAttachment
                    mediaUrl={msg.media_url}
                    mediaType={msg.media_type}
                    message={msg.message}
                    imageClassName="max-w-full rounded mb-1"
                    videoClassName="max-w-full rounded mb-1"
                    audioClassName="max-w-full mb-1"
                    pdfClassName="w-full h-64 rounded-md border border-border bg-background mb-2"
                  />
                  <p className="whitespace-pre-wrap break-words text-[13px]">{msg.message}</p>
                  <p className={`text-[10px] mt-0.5 text-right flex items-center justify-end ${msg.direction === "outgoing" ? "text-[#667781]" : "text-muted-foreground"}`}>
                    {formatTime(msg.created_at)}
                    {renderMessageStatus(msg)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Hidden file inputs */}
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleMediaFile} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleMediaFile} />
        <input ref={documentInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" className="hidden" onChange={handleMediaFile} />

        {/* Input area */}
        <div className="border-t bg-background flex-shrink-0">
          {/* Media buttons row */}
          <div className="flex items-center gap-1 px-3 pt-2">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => imageInputRef.current?.click()} disabled={isUploadingMedia || isRecording}>
              <Image className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => videoInputRef.current?.click()} disabled={isUploadingMedia || isRecording}>
              <Video className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => documentInputRef.current?.click()} disabled={isUploadingMedia || isRecording}>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </Button>
            {isUploadingMedia && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Enviando...
              </div>
            )}
          </div>

          {/* Recording UI or text input */}
          <div className="flex items-center gap-2 p-3 pt-1">
            {isRecording ? (
              <div className="flex-1 flex items-center gap-3">
                <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={cancelRecording}>
                  <X className="h-4 w-4" />
                </Button>
                <div className="flex-1 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-mono text-destructive">{formatRecordingTime(recordingDuration)}</span>
                  <span className="text-xs text-muted-foreground">Gravando...</span>
                </div>
                <Button size="icon" onClick={stopRecording} className="bg-[#00a884] hover:bg-[#008069] h-9 w-9">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 text-sm"
                  disabled={isSending || isUploadingMedia}
                />
                {newMessage.trim() ? (
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={isSending}
                    className="bg-[#00a884] hover:bg-[#008069] h-9 w-9"
                  >
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={startRecording}
                    disabled={isUploadingMedia}
                    className="h-9 w-9"
                  >
                    <Mic className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
