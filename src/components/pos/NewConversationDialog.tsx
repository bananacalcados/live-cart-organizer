import { useState, useEffect, useMemo, useRef } from "react";
import { UserPlus, Send, Loader2, Search, FileText, MessageCircle, Wifi, Check, Paperclip, Mic, Square, X, Play, Pause, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppNumberStore, WhatsAppNumber } from "@/stores/whatsappNumberStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated: (phone: string, whatsappNumberId?: string | null) => void;
  /** Instances available to this POS/store. If omitted, falls back to all numbers from the store. */
  instances?: WhatsAppNumber[];
  /** Pre-fill the phone field when opening (e.g. from a customer list). */
  initialPhone?: string;
  /** Pre-fill the contact name field when opening. */
  initialName?: string;
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

interface LeadData {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  address?: string;
  cpf?: string;
}

type Provider = "zapi" | "meta" | "wasender" | "uazapi";

const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta API",
  zapi: "Z-API",
  wasender: "WaSender",
  uazapi: "UAZAPI",
};

export function NewConversationDialog({ open, onOpenChange, onConversationCreated, instances, initialPhone, initialName }: Props) {
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"normal" | "template">("normal");
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [templateSearch, setTemplateSearch] = useState("");

  // Lead data auto-fill
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [lookingUpLead, setLookingUpLead] = useState(false);

  // Media attachment
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingMimeRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const { numbers: storeNumbers, fetchNumbers, isLoading: loadingNumbers } = useWhatsAppNumberStore();

  // Ensure the global WhatsApp instances are loaded when the dialog opens
  // (e.g. opened from the POS Clientes list where nothing else fetched them).
  useEffect(() => {
    if (open && (!instances || instances.length === 0) && storeNumbers.length === 0) {
      fetchNumbers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Only ONLINE instances are selectable. Meta numbers don't expose a realtime
  // connection flag (always reachable via API), so they're always considered online.
  const onlineInstances = useMemo(() => {
    const pool = (instances && instances.length > 0) ? instances : storeNumbers;
    return pool.filter(n => n.provider === "meta" || n.is_online === true);
  }, [instances, storeNumbers]);

  const selectedInstance = useMemo(
    () => onlineInstances.find(n => n.id === selectedInstanceId) || null,
    [onlineInstances, selectedInstanceId]
  );
  const provider: Provider = (selectedInstance?.provider as Provider) || "zapi";

  // Pre-fill phone/name when the dialog opens with initial values.
  useEffect(() => {
    if (!open) return;
    if (initialPhone) setContactPhone(initialPhone.replace(/\D/g, ""));
    if (initialName) setContactName(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPhone, initialName]);

  // Auto-select the first online instance when the dialog opens / list changes.
  useEffect(() => {
    if (!open) return;
    if (selectedInstanceId && onlineInstances.some(n => n.id === selectedInstanceId)) return;
    setSelectedInstanceId(onlineInstances[0]?.id || null);
  }, [open, onlineInstances, selectedInstanceId]);

  // Reset template flow if we leave a meta instance.
  useEffect(() => {
    if (provider !== "meta" && messageType === "template") {
      setMessageType("normal");
      setSelectedTemplate(null);
    }
  }, [provider, messageType]);

  // Load templates when Meta is selected and template mode
  useEffect(() => {
    if (provider === "meta" && messageType === "template" && selectedInstanceId) {
      loadTemplates(selectedInstanceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, messageType, selectedInstanceId]);

  // Lookup lead data when phone changes
  useEffect(() => {
    if (contactPhone.replace(/\D/g, "").length >= 8) {
      lookupLead(contactPhone);
    } else {
      setLeadData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactPhone]);

  const loadTemplates = async (numberId: string) => {
    setLoadingTemplates(true);
    setTemplates([]);
    try {
      const { data } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: numberId, status: "APPROVED" },
      });
      if (data?.templates) {
        setTemplates(data.templates.filter((t: MetaTemplate) => t.status === "APPROVED"));
      }
    } catch (e) {
      console.error("Error loading templates:", e);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const lookupLead = async (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 8) return;
    setLookingUpLead(true);
    try {
      const [posRes] = await Promise.all([
        supabase.from("pos_customers" as any).select("name, email, whatsapp, cpf, city, state, address").ilike("whatsapp", `%${clean.slice(-8)}%`).limit(1).maybeSingle(),
        supabase.from("customers").select("instagram_handle, whatsapp").ilike("whatsapp", `%${clean.slice(-8)}%`).limit(1).maybeSingle(),
      ]);

      const posData = posRes.data as any;
      if (posData) {
        setLeadData({
          name: posData.name || undefined,
          email: posData.email || undefined,
          phone: posData.whatsapp || undefined,
          city: posData.city || undefined,
          state: posData.state || undefined,
          address: posData.address || undefined,
          cpf: posData.cpf || undefined,
        });
        if (!contactName && posData.name) setContactName(posData.name);
      } else {
        setLeadData(null);
      }
    } catch (e) {
      console.error("Lead lookup error:", e);
    } finally {
      setLookingUpLead(false);
    }
  };

  const extractTemplateVariables = (template: MetaTemplate): string[] => {
    const vars: string[] = [];
    for (const comp of template.components) {
      const text = comp.text || "";
      const matches = text.match(/\{\{(\d+)\}\}/g) || [];
      for (const m of matches) {
        if (!vars.includes(m)) vars.push(m);
      }
    }
    return vars.sort();
  };

  const getTemplatePreview = (template: MetaTemplate): string => {
    let preview = "";
    for (const comp of template.components) {
      if (comp.type === "BODY" && comp.text) {
        preview = comp.text;
        break;
      }
    }
    Object.entries(templateVars).forEach(([key, value]) => {
      if (value) preview = preview.replace(key, value);
    });
    return preview;
  };

  const autoFillVariable = (varKey: string): string => {
    if (!leadData) return "";
    const index = parseInt(varKey.replace(/[{}]/g, ""));
    switch (index) {
      case 1: return leadData.name || "";
      case 2: return leadData.email || leadData.phone || "";
      case 3: return leadData.city || "";
      case 4: return leadData.state || "";
      default: return "";
    }
  };

  const handleAutoFill = () => {
    if (!selectedTemplate || !leadData) return;
    const vars = extractTemplateVariables(selectedTemplate);
    const filled: Record<string, string> = {};
    for (const v of vars) {
      filled[v] = autoFillVariable(v);
    }
    setTemplateVars(filled);
  };

  const handleSelectTemplate = (template: MetaTemplate) => {
    setSelectedTemplate(template);
    const vars = extractTemplateVariables(template);
    const initial: Record<string, string> = {};
    for (const v of vars) {
      initial[v] = autoFillVariable(v);
    }
    setTemplateVars(initial);
  };

  // ---- Media attachment ----
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
  };

  const clearPendingFile = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
  };

  // ---- Audio recording ----
  const startRecording = async () => {
    try {
      clearAudio();
      const { getAudioMimeType } = await import("@/lib/audioRecorder");
      const mime = getAudioMimeType();
      recordingMimeRef.current = mime;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunksRef.current.push(ev.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setIsRecording(false);
        const { getAudioContentType } = await import("@/lib/audioRecorder");
        const ct = getAudioContentType(recordingMimeRef.current);
        const blob = new Blob(audioChunksRef.current, { type: ct });
        if (blob.size === 0) return;
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (err) {
      console.error("mic error", err);
      toast.error("Não foi possível acessar o microfone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const clearAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioPlaying(false);
  };

  const toggleAudioPlay = () => {
    if (!audioElRef.current) return;
    if (audioPlaying) { audioElRef.current.pause(); setAudioPlaying(false); }
    else { audioElRef.current.play(); setAudioPlaying(true); }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const sendMediaUrl = async (numberId: string, phone: string, mediaUrl: string, mediaType: string, caption?: string) => {
    const body: Record<string, any> = { phone, mediaUrl, mediaType, caption: caption || "", whatsapp_number_id: numberId };
    if (provider === "meta") {
      await supabase.functions.invoke("meta-whatsapp-send", { body: { ...body, type: mediaType } });
    } else if (provider === "wasender") {
      await supabase.functions.invoke("wasender-send-media", { body });
    } else if (provider === "uazapi") {
      await supabase.functions.invoke("uazapi-send-media", { body });
    } else {
      await supabase.functions.invoke("zapi-send-media", { body });
    }
    await supabase.from("whatsapp_messages").insert({
      phone, message: caption || "", direction: "outgoing", status: "sent",
      whatsapp_number_id: numberId, media_url: mediaUrl, media_type: mediaType,
    });
  };

  const handleSend = async () => {
    const cleanPhone = contactPhone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      toast.error("Telefone inválido");
      return;
    }
    if (!selectedInstance) {
      toast.error("Selecione uma instância online");
      return;
    }

    const numberId = selectedInstance.id;
    setSending(true);
    try {
      if (provider === "meta" && messageType === "template" && selectedTemplate) {
        const parameters = extractTemplateVariables(selectedTemplate).map(v => ({
          type: "text",
          text: templateVars[v] || "",
        }));

        await supabase.functions.invoke("meta-whatsapp-send-template", {
          body: {
            phone: cleanPhone,
            templateName: selectedTemplate.name,
            language: selectedTemplate.language,
            components: parameters.length > 0 ? [{ type: "body", parameters }] : [],
            whatsappNumberId: numberId,
          },
        });

        const previewText = `[Template: ${selectedTemplate.name}] ${getTemplatePreview(selectedTemplate)}`;
        await supabase.from("whatsapp_messages").insert({
          phone: cleanPhone,
          message: previewText,
          direction: "outgoing",
          status: "sent",
          whatsapp_number_id: numberId,
        });
      } else {
        const text = messageText.trim();
        const hasMedia = !!pendingFile;
        const hasAudio = !!audioBlob;

        if (!text && !hasMedia && !hasAudio) {
          toast.error("Digite uma mensagem ou anexe um arquivo");
          setSending(false);
          return;
        }

        // Audio
        if (hasAudio) {
          const { getAudioExtension, getAudioContentType } = await import("@/lib/audioRecorder");
          const ext = getAudioExtension(recordingMimeRef.current);
          const ct = getAudioContentType(recordingMimeRef.current);
          const audioFile = new File([audioBlob!], `audio-${Date.now()}.${ext}`, { type: ct });
          const url = await uploadMediaToStorage(audioFile);
          if (!url) throw new Error("upload audio failed");
          await sendMediaUrl(numberId, cleanPhone, url, "audio");
        }

        // Media (image/video/document)
        if (hasMedia) {
          const mediaType = pendingFile!.type.startsWith("image/") ? "image"
            : pendingFile!.type.startsWith("video/") ? "video"
            : pendingFile!.type.startsWith("audio/") ? "audio" : "document";
          const url = await uploadMediaToStorage(pendingFile!);
          if (!url) throw new Error("upload media failed");
          await sendMediaUrl(numberId, cleanPhone, url, mediaType, text || undefined);
        }

        // Plain text (only if no media carried the caption)
        if (text && !hasMedia) {
          if (provider === "meta") {
            await supabase.functions.invoke("meta-whatsapp-send", {
              body: { phone: cleanPhone, message: text, whatsapp_number_id: numberId },
            });
          } else if (provider === "wasender") {
            await supabase.functions.invoke("wasender-send-message", {
              body: { phone: cleanPhone, message: text, whatsapp_number_id: numberId },
            });
          } else if (provider === "uazapi") {
            await supabase.functions.invoke("uazapi-send-message", {
              body: { phone: cleanPhone, message: text, whatsapp_number_id: numberId },
            });
          } else {
            await supabase.functions.invoke("zapi-send-message", {
              body: { phone: cleanPhone, message: text, whatsapp_number_id: numberId },
            });
          }

          await supabase.from("whatsapp_messages").insert({
            phone: cleanPhone, message: text, direction: "outgoing", status: "sent",
            whatsapp_number_id: numberId,
          });
        }
      }

      // Save contact
      await supabase.from("chat_contacts").upsert(
        { phone: cleanPhone, custom_name: contactName.trim() || null },
        { onConflict: "phone" }
      );

      toast.success("Mensagem enviada!");
      onConversationCreated(cleanPhone, numberId);
      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error("Error sending:", error);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setContactName("");
    setContactPhone("");
    setMessageText("");
    setSelectedTemplate(null);
    setTemplateVars({});
    setMessageType("normal");
    setLeadData(null);
    clearPendingFile();
    clearAudio();
  };

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(templateSearch.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-[#00a884]" />
            Nova Conversa
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 pb-4 space-y-4">
            {/* Contact Info */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nome do contato (opcional)</Label>
                <Input
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  placeholder="Ex: Maria Silva"
                  className="h-9 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Telefone *</Label>
                <Input
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                  placeholder="5511999999999"
                  className="h-9 text-sm mt-1"
                />
                {lookingUpLead && <p className="text-[10px] text-muted-foreground mt-1">Buscando dados do cliente...</p>}
                {leadData && (
                  <div className="mt-1.5 p-2 rounded-lg bg-[#00a884]/5 border border-[#00a884]/20 text-xs space-y-0.5">
                    <p className="font-medium text-[#00a884]">Cliente encontrado:</p>
                    {leadData.name && <p>Nome: {leadData.name}</p>}
                    {leadData.email && <p>Email: {leadData.email}</p>}
                    {leadData.city && <p>Cidade: {leadData.city} {leadData.state ? `- ${leadData.state}` : ""}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Instance selection (online only) */}
            <div>
              <Label className="text-xs">Instância (somente online)</Label>
              {onlineInstances.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground p-3 rounded-lg border border-dashed text-center flex items-center justify-center gap-2">
                  {loadingNumbers ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando instâncias...</>
                  ) : (
                    "Nenhuma instância online disponível para esta loja."
                  )}
                </p>
              ) : (
                <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-border/60">
                  <div className="space-y-1.5 p-1.5">
                    {onlineInstances.map(inst => {
                      const active = inst.id === selectedInstanceId;
                      return (
                        <button
                          key={inst.id}
                          type="button"
                          onClick={() => setSelectedInstanceId(inst.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                            active
                              ? "bg-[#00a884]/10 border-[#00a884]"
                              : "bg-background border-border hover:border-[#00a884]/50"
                          }`}
                        >
                          <Wifi className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[#00a884]" : "text-emerald-500"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{inst.label}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {inst.phone_display} · {PROVIDER_LABEL[inst.provider || "zapi"] || inst.provider}
                            </p>
                          </div>
                          {active && <Check className="h-4 w-4 text-[#00a884] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Message Type (Meta only) */}
            {provider === "meta" && (
              <div>
                <Label className="text-xs">Tipo de mensagem</Label>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setMessageType("normal")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      messageType === "normal" ? "bg-[#00a884] text-white border-[#00a884]" : "bg-background border-border text-muted-foreground"
                    }`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Mensagem
                  </button>
                  <button
                    onClick={() => setMessageType("template")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      messageType === "template" ? "bg-[#00a884] text-white border-[#00a884]" : "bg-background border-border text-muted-foreground"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Template
                  </button>
                </div>
              </div>
            )}

            {/* Normal Message + rich composer */}
            {!(provider === "meta" && messageType === "template") && (
              <div>
                <Label className="text-xs">Mensagem</Label>

                {/* Image / file preview */}
                {pendingFile && (
                  <div className="mt-1.5 flex items-center gap-2 p-2 rounded-lg border bg-muted/40">
                    {pendingFile.type.startsWith("image/") && pendingPreviewUrl ? (
                      <img src={pendingPreviewUrl} alt="preview" className="h-12 w-12 rounded object-cover" />
                    ) : (
                      <Paperclip className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs truncate flex-1">{pendingFile.name}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={clearPendingFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Audio preview */}
                {audioUrl && !isRecording && (
                  <div className="mt-1.5 flex items-center gap-2 p-2 rounded-lg border bg-muted/40">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={toggleAudioPlay}>
                      {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <span className="text-xs flex-1 text-muted-foreground">Áudio gravado</span>
                    <audio ref={audioElRef} src={audioUrl} onEnded={() => setAudioPlaying(false)} className="hidden" />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={clearAudio}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Recording indicator */}
                {isRecording ? (
                  <div className="mt-1.5 flex items-center gap-2 p-3 rounded-lg border border-red-300 bg-red-50">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm text-red-600 flex-1">Gravando... {fmtTime(recordingTime)}</span>
                    <Button type="button" size="sm" className="h-8 gap-1 bg-red-500 hover:bg-red-600" onClick={stopRecording}>
                      <Square className="h-3.5 w-3.5" /> Parar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-end gap-1.5">
                    <div className="flex-1">
                      <Textarea
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        placeholder={pendingFile ? "Legenda (opcional)..." : "Digite sua mensagem..."}
                        className="text-sm min-h-[80px]"
                      />
                    </div>
                    <div className="flex flex-col gap-1 pb-1">
                      <EmojiPickerButton
                        onEmojiSelect={(emoji) => setMessageText(prev => prev + emoji)}
                        className="h-8 w-8"
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()} title="Anexar imagem/arquivo">
                        <Paperclip className="h-5 w-5 text-gray-500" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={startRecording} title="Gravar áudio">
                        <Mic className="h-5 w-5 text-gray-500" />
                      </Button>
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf"
                  className="hidden"
                  onChange={handleFilePick}
                />
              </div>
            )}

            {/* Template Selection */}
            {provider === "meta" && messageType === "template" && (
              <div className="space-y-3">
                {!selectedTemplate ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={templateSearch}
                        onChange={e => setTemplateSearch(e.target.value)}
                        placeholder="Buscar template..."
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    {loadingTemplates ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredTemplates.map(t => (
                          <button
                            key={t.name}
                            onClick={() => handleSelectTemplate(t)}
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
                        {filteredTemplates.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-4">Nenhum template encontrado</p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium">{selectedTemplate.name}</p>
                        <div className="flex gap-1 mt-0.5">
                          <Badge variant="secondary" className="text-[9px]">{selectedTemplate.language}</Badge>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSelectedTemplate(null); setTemplateVars({}); }}>
                        Trocar
                      </Button>
                    </div>

                    {/* Template Preview */}
                    <div className="p-3 rounded-lg bg-muted/50 border text-xs whitespace-pre-wrap">
                      {getTemplatePreview(selectedTemplate)}
                    </div>

                    {/* Variables */}
                    {extractTemplateVariables(selectedTemplate).length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Variáveis</Label>
                          {leadData && (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] text-[#00a884]" onClick={handleAutoFill}>
                              Preencher do cliente
                            </Button>
                          )}
                        </div>
                        {extractTemplateVariables(selectedTemplate).map(v => (
                          <div key={v} className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] shrink-0">{v}</Badge>
                            <Input
                              value={templateVars[v] || ""}
                              onChange={e => setTemplateVars(prev => ({ ...prev, [v]: e.target.value }))}
                              placeholder={`Valor para ${v}`}
                              className="h-7 text-xs flex-1"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); resetForm(); }}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1"
            disabled={sending || !contactPhone.replace(/\D/g, "") || !selectedInstance}
            onClick={handleSend}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
