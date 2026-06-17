import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { useConversationInstance } from "@/hooks/useConversationInstance";
import { useChatSender, type SendRoute } from "@/hooks/chat/useChatSender";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { normalizeBRPhone } from "@/lib/phoneUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MessageCircle, Send, Mic, Square, Trash2, Image as ImageIcon, Play, Pause, Loader2, Lock, Phone,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  phone: string;
  name?: string;
  sellerName?: string;
  /** Chamado após o envio bem-sucedido (ex.: marcar contato como falado). */
  onSent?: () => void;
}

function providerFor(provider?: string): SendRoute["provider"] {
  if (provider === "meta") return "meta";
  if (provider === "wasender") return "wasender";
  if (provider === "uazapi") return "uazapi";
  return "zapi";
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function POSTaskMessageDialog({ open, onClose, phone, name, sellerName, onSent }: Props) {
  const normalizedPhone = phone ? normalizeBRPhone(phone) : phone;
  const { numbers, fetchNumbers } = useWhatsAppNumberStore();
  const { boundNumberId, isLocked } = useConversationInstance(normalizedPhone);
  const { sendText, sendMedia, sendAudio, isSending } = useChatSender();
  const currentUserId = useCurrentUserId();

  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // Áudio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingMimeRef = useRef<string>("");
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Imagem
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      if (numbers.length === 0) fetchNumbers();
      setMessage("");
    }
  }, [open, numbers.length, fetchNumbers]);

  // Define a instância PADRÃO: usa a vinculada (se houver histórico), senão a
  // default/primeira. A vendedora pode trocar livremente — o envio força a
  // instância escolhida (header x-force-instance) para prospecção ativa.
  useEffect(() => {
    if (!open || instanceId) return;
    if (boundNumberId) {
      setInstanceId(boundNumberId);
    } else {
      const def = numbers.find((n) => n.is_default) || numbers[0];
      if (def) setInstanceId(def.id);
    }
  }, [open, boundNumberId, numbers, instanceId]);

  const selectedNumber = numbers.find((n) => n.id === instanceId) || null;

  const buildRoute = useCallback((): SendRoute | null => {
    if (!instanceId || !selectedNumber) {
      toast.error("Selecione a instância de envio.");
      return null;
    }
    return { channel: "whatsapp", provider: providerFor(selectedNumber.provider), numberId: instanceId };
  }, [instanceId, selectedNumber]);

  const senderName = sellerName || null;

  const handleSentSuccess = useCallback(() => {
    onSent?.();
    onClose();
  }, [onSent, onClose]);

  // ---------------- Texto ----------------
  const handleSendText = async () => {
    const route = buildRoute();
    if (!route) return;
    if (!message.trim()) { toast.error("Escreva uma mensagem."); return; }
    const res = await sendText({
      phone: normalizedPhone, message: message.trim(), route,
      senderUserId: currentUserId, senderName, forceInstance: true,
    });
    if (res.success) { toast.success("Mensagem enviada!"); handleSentSuccess(); }
  };

  // ---------------- Imagem ----------------
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const clearMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
  };

  const handleSendMedia = async () => {
    const route = buildRoute();
    if (!route || !mediaFile) return;
    setUploading(true);
    try {
      const url = await uploadMediaToStorage(mediaFile);
      if (!url) { toast.error("Erro ao enviar imagem"); return; }
      const mediaType = mediaFile.type.startsWith("image/") ? "image"
        : mediaFile.type.startsWith("video/") ? "video" : "document";
      const res = await sendMedia({
        phone: normalizedPhone, mediaUrl: url, mediaType,
        caption: message.trim() || undefined, route,
        senderUserId: currentUserId, senderName,
      });
      if (res.success) { toast.success("Imagem enviada!"); clearMedia(); handleSentSuccess(); }
    } finally {
      setUploading(false);
    }
  };

  // ---------------- Áudio ----------------
  const startRecording = async () => {
    try {
      const { getAudioMimeType } = await import("@/lib/audioRecorder");
      const mimeType = getAudioMimeType();
      recordingMimeRef.current = mimeType;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      cancelledRef.current = false;

      mr.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setIsRecording(false);
        setRecordingTime(0);
        if (cancelledRef.current) { audioChunksRef.current = []; return; }
        const { getAudioContentType } = await import("@/lib/audioRecorder");
        const ct = getAudioContentType(recordingMimeRef.current);
        const blob = new Blob(audioChunksRef.current, { type: ct });
        if (blob.size === 0) return;
        audioBlobRef.current = blob;
        setAudioPreviewUrl(URL.createObjectURL(blob));
      };

      mr.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      cancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      cancelledRef.current = true;
      audioChunksRef.current = [];
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    setRecordingTime(0);
  };

  const discardAudio = () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    audioBlobRef.current = null;
    setAudioPreviewUrl(null);
    setAudioPlaying(false);
  };

  const toggleAudioPlay = () => {
    if (!audioElRef.current) return;
    if (audioPlaying) { audioElRef.current.pause(); setAudioPlaying(false); }
    else { audioElRef.current.play(); setAudioPlaying(true); }
  };

  const handleSendAudio = async () => {
    const route = buildRoute();
    if (!route || !audioBlobRef.current) return;
    setUploading(true);
    try {
      const { getAudioExtension, getAudioContentType } = await import("@/lib/audioRecorder");
      const ct = getAudioContentType(recordingMimeRef.current);
      const ext = getAudioExtension(recordingMimeRef.current);
      const file = new File([audioBlobRef.current], `audio-${Date.now()}.${ext}`, { type: ct });
      const url = await uploadMediaToStorage(file);
      if (!url) { toast.error("Erro ao enviar áudio"); return; }
      const res = await sendAudio({
        phone: normalizedPhone, mediaUrl: url, route,
        senderUserId: currentUserId, senderName,
      });
      if (res.success) { toast.success("Áudio enviado!"); discardAudio(); handleSentSuccess(); }
    } finally {
      setUploading(false);
    }
  };

  const busy = isSending || uploading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) { cancelRecording(); onClose(); } }}>
      <DialogContent className="max-w-md w-[95vw] bg-pos-black border-2 border-[#00a884]/50 text-pos-white p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 bg-gradient-to-r from-[#00a884]/20 to-transparent border-b border-[#00a884]/30">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <MessageCircle className="h-5 w-5 text-[#00a884]" />
            Enviar WhatsApp
          </DialogTitle>
          <p className="text-sm text-pos-white/70 mt-0.5">{name || "Cliente"}</p>
          <p className="text-[11px] text-pos-white/40 flex items-center gap-1">
            <Phone className="h-3 w-3" /> {phone}
          </p>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3">
          {/* Instância */}
          <div>
            <label className="text-xs text-pos-white/60 mb-1 flex items-center gap-1">
              Instância de envio
              {isLocked && <Lock className="h-3 w-3 text-amber-400" />}
            </label>
            <Select value={instanceId || ""} onValueChange={setInstanceId} disabled={isLocked}>
              <SelectTrigger className="bg-pos-white/5 border-pos-white/15 text-pos-white h-9">
                <SelectValue placeholder="Escolher instância" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} · {n.phone_display}
                    {n.is_online === false ? " (offline)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLocked && (
              <p className="text-[10px] text-amber-400/80 mt-1">
                Conversa já vinculada a esta instância — envio fixo para evitar mistura.
              </p>
            )}
          </div>

          {/* Preview de imagem */}
          {mediaPreview && (
            <div className="relative rounded-lg overflow-hidden border border-pos-white/15">
              <img src={mediaPreview} alt="prévia" className="max-h-48 w-full object-contain bg-black" />
              <button
                onClick={clearMedia}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Preview de áudio */}
          {audioPreviewUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-pos-white/15 bg-pos-white/5 px-3 py-2">
              <button onClick={toggleAudioPlay} className="h-8 w-8 rounded-full bg-[#00a884] flex items-center justify-center text-white">
                {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <span className="text-xs text-pos-white/70 flex-1">Áudio gravado</span>
              <button onClick={discardAudio} className="h-7 w-7 rounded-full bg-pos-white/10 flex items-center justify-center text-red-400 hover:bg-red-500/20">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <audio ref={audioElRef} src={audioPreviewUrl} onEnded={() => setAudioPlaying(false)} className="hidden" />
            </div>
          )}

          {/* Gravando */}
          {isRecording ? (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3">
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-pos-white font-mono flex-1">{fmtTime(recordingTime)}</span>
              <Button size="sm" variant="ghost" onClick={cancelRecording} className="text-red-400 h-8">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={stopRecording} className="bg-[#00a884] hover:bg-[#00916f] text-white h-8 gap-1">
                <Square className="h-3.5 w-3.5" /> Parar
              </Button>
            </div>
          ) : (
            !audioPreviewUrl && (
              <div className="relative">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={mediaPreview ? "Legenda (opcional)..." : "Escreva sua mensagem..."}
                  className="bg-pos-white/5 border-pos-white/15 text-pos-white min-h-[90px] pr-10 resize-none"
                />
                <div className="absolute bottom-1.5 right-1.5">
                  <EmojiPickerButton onEmojiSelect={(e) => setMessage((m) => m + e)} className="h-8 w-8" />
                </div>
              </div>
            )
          )}

          {/* Barra de ações */}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
            {!isRecording && !audioPreviewUrl && !mediaPreview && (
              <>
                <Button
                  size="icon" variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 w-10 border-pos-white/20 bg-pos-white/5 text-pos-white hover:bg-pos-white/10"
                  title="Enviar imagem"
                >
                  <ImageIcon className="h-5 w-5" />
                </Button>
                <Button
                  size="icon" variant="outline"
                  onClick={startRecording}
                  className="h-10 w-10 border-pos-white/20 bg-pos-white/5 text-pos-white hover:bg-pos-white/10"
                  title="Gravar áudio"
                >
                  <Mic className="h-5 w-5" />
                </Button>
              </>
            )}

            {/* Botão de envio contextual */}
            {audioPreviewUrl ? (
              <Button onClick={handleSendAudio} disabled={busy} className="flex-1 bg-[#00a884] hover:bg-[#00916f] text-white gap-2 h-10">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar áudio
              </Button>
            ) : mediaPreview ? (
              <Button onClick={handleSendMedia} disabled={busy} className="flex-1 bg-[#00a884] hover:bg-[#00916f] text-white gap-2 h-10">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar imagem
              </Button>
            ) : !isRecording ? (
              <Button onClick={handleSendText} disabled={busy || !message.trim()} className={cn("flex-1 bg-[#00a884] hover:bg-[#00916f] text-white gap-2 h-10")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
