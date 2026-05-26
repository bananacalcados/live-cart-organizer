import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWaMessageBroadcast } from "@/hooks/useWaMessageBroadcast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Instagram, Send, Loader2, AlertCircle, Info, Camera, Video, Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { convertAudioBlobToWav } from "@/lib/audioRecorder";

interface DMMessage {
  id: string;
  message: string | null;
  direction: "incoming" | "outgoing";
  created_at: string;
  status: string | null;
  media_type: string | null;
  media_url: string | null;
}

interface InstagramDMChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;          // sem @
  eventId?: string;
  fallbackCommentId?: string; // último comment_id desse usuário (pra private_reply)
  profilePicUrl?: string | null;
}

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

export function InstagramDMChat({
  open,
  onOpenChange,
  username,
  eventId,
  fallbackCommentId,
  profilePicUrl,
}: InstagramDMChatProps) {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [igUserId, setIgUserId] = useState<string | null>(null);
  const [discoveredCommentId, setDiscoveredCommentId] = useState<string | null>(null);
  const [discoveredCommentInfo, setDiscoveredCommentInfo] = useState<{ when: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const handle = cleanHandle(username);

  // commentId efetivo: prop tem prioridade, senão usa o auto-descoberto
  const effectiveCommentId = fallbackCommentId || discoveredCommentId || undefined;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!handle) return;
    setLoading(true);
    try {
      // 1) Achar o ig_user_id desse @
      const { data: link } = await supabase
        .from("instagram_user_links")
        .select("ig_user_id")
        .ilike("username", handle)
        .maybeSingle();

      let userId = link?.ig_user_id || null;

      if (!userId) {
        // fallback via whatsapp_messages (sender_name)
        const { data: m } = await supabase
          .from("whatsapp_messages")
          .select("phone")
          .eq("channel", "instagram")
          .ilike("sender_name", `@${handle}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        userId = (m?.phone && /^\d+$/.test(m.phone)) ? m.phone : null;
      }

      setIgUserId(userId);

      // Auto-descobrir comment_id recente (últimos 7 dias) para Private Reply
      // — vale tanto pra primeira mensagem quanto pra recuperar conversa fora da janela de 24h
      if (!fallbackCommentId) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recentComment } = await supabase
          .from("live_comments")
          .select("comment_id, comment_text, created_at")
          .ilike("username", handle)
          .gte("created_at", sevenDaysAgo)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recentComment?.comment_id) {
          setDiscoveredCommentId(recentComment.comment_id);
          setDiscoveredCommentInfo({
            when: new Date(recentComment.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
            text: recentComment.comment_text || "",
          });
        } else {
          setDiscoveredCommentId(null);
          setDiscoveredCommentInfo(null);
        }
      }

      if (!userId) {
        setMessages([]);
        return;
      }

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, message, direction, created_at, status, media_type, media_url")
        .eq("channel", "instagram")
        .eq("phone", userId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      setMessages((data || []) as DMMessage[]);
      scrollToBottom();

      // Marcar como lido
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("instagram_dm_reads").upsert({
          user_id: user.id,
          username: handle,
          last_read_at: new Date().toISOString(),
        }, { onConflict: "user_id,username" });
      }
    } catch (err: any) {
      console.error("[IG DM] load error:", err);
      toast.error("Erro ao carregar histórico");
    } finally {
      setLoading(false);
    }
  }, [handle, scrollToBottom]);

  useEffect(() => {
    if (open) loadHistory();
  }, [open, loadHistory]);

  // Broadcast-based new-message notification (postgres_changes removed for CPU).
  // Filters Instagram-channel messages via refetch in loadHistory.
  useWaMessageBroadcast((payload) => {
    if (!open || !igUserId) return;
    if (payload?.phone !== igUserId) return;
    loadHistory();
    scrollToBottom();
  });


  // ====== Upload + envio de mídia ======
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState<null | "audio" | "video">(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const guessMediaType = (file: { type: string; name?: string }): "image" | "video" | "audio" => {
    const t = (file.type || "").toLowerCase();
    if (t.startsWith("video")) return "video";
    if (t.startsWith("audio")) return "audio";
    return "image";
  };

  const persistOutgoingMessage = useCallback(async (payload: {
    messageId?: string | null;
    phone?: string | null;
    message: string;
    mediaType?: string | null;
    mediaUrl?: string | null;
  }) => {
    if (!payload.messageId && !payload.phone) return;

    const row = {
      phone: payload.phone || igUserId || handle,
      message: payload.message,
      direction: "outgoing" as const,
      channel: "instagram",
      status: "sent",
      message_id: payload.messageId || null,
      sender_name: `@${handle}`,
      media_type: payload.mediaType || (payload.mediaUrl ? "image" : "text"),
      media_url: payload.mediaUrl || null,
      source: "manual",
    };

    if (payload.messageId) {
      const { data: existing, error: existingError } = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("message_id", payload.messageId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from("whatsapp_messages")
          .update({
            phone: row.phone,
            message: row.message,
            status: row.status,
            sender_name: row.sender_name,
            media_type: row.media_type,
            media_url: row.media_url,
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;
        return;
      }
    }

    const { error: insertError } = await supabase.from("whatsapp_messages").insert(row);
    if (insertError) throw insertError;
  }, [handle, igUserId]);

  const uploadAndSend = async (file: Blob, opts: { mediaType: "image" | "video" | "audio"; extension: string; caption?: string }) => {
    if (sending || uploading) return;
    setUploading(true);
    try {
      const path = `instagram-dm/${handle}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${opts.extension}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file, {
        contentType: file.type || (opts.mediaType === "image" ? "image/jpeg" : opts.mediaType === "video" ? "video/mp4" : "audio/mpeg"),
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      setSending(true);
      const { data, error } = await supabase.functions.invoke("instagram-dm-send", {
        body: {
          username: handle,
          message: opts.caption || "",
          mediaUrl: publicUrl,
          mediaType: opts.mediaType,
          eventId,
          fallbackCommentId: effectiveCommentId,
        },
      });
      if (error) {
        // FunctionsHttpError não expõe o body — tentamos ler para mensagens amigáveis
        let friendly = "";
        try {
          const ctx: any = (error as any).context;
          const resp = ctx?.response ? await ctx.response.clone().json() : null;
          if (resp?.error === "unsupported_audio_format") friendly = resp.message;
          else if (resp?.message) friendly = resp.message;
        } catch {}
        throw new Error(friendly || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      await persistOutgoingMessage({
        messageId: (data as any)?.messageId || null,
        phone: (data as any)?.ig_user_id || igUserId,
        message: opts.caption || "[media]",
        mediaType: opts.mediaType,
        mediaUrl: publicUrl,
      });
      toast.success(`${opts.mediaType === "image" ? "Foto" : opts.mediaType === "video" ? "Vídeo" : "Áudio"} enviado!`);
      await loadHistory();
    } catch (err: any) {
      console.error("[IG DM] media send error:", err);
      toast.error(err.message || "Falha ao enviar mídia");
    } finally {
      setUploading(false);
      setSending(false);
    }
  };


  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset
    if (!file) return;
    const mediaType = guessMediaType(file);
    const ext = (file.name.split(".").pop() || (mediaType === "image" ? "jpg" : mediaType === "video" ? "mp4" : "m4a")).toLowerCase();
    await uploadAndSend(file, { mediaType, extension: ext });
  };

  // ====== Gravação ao vivo (áudio/vídeo via MediaRecorder) ======
  const stopRecording = useCallback((cancel = false) => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      (mr as any)._cancelled = cancel;
      mr.stop();
    }
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const startRecording = async (kind: "audio" | "video") => {
    if (recording) return;
    try {
      const constraints: MediaStreamConstraints =
        kind === "audio" ? { audio: true } : { audio: true, video: { facingMode: "environment" } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      recordStreamRef.current = stream;

      // IG só aceita áudio em aac/m4a/wav/mp4. No Chrome gravamos webm e convertemos para wav no cliente.
      const mimeCandidates = kind === "audio"
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"]
        : ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mimeType = mimeCandidates.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || "";
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data?.size) recordChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        setRecording(null);
        setRecordSeconds(0);
        const cancelled = (mr as any)._cancelled;
        if (cancelled) return;
        const blob = new Blob(recordChunksRef.current, { type: mr.mimeType || (kind === "audio" ? "audio/webm" : "video/webm") });
        if (kind === "audio") {
          const wavBlob = await convertAudioBlobToWav(blob);
          await uploadAndSend(wavBlob, { mediaType: "audio", extension: "wav" });
          return;
        }
        const ext = (mr.mimeType || "").includes("mp4") ? "mp4" : "webm";
        await uploadAndSend(blob, { mediaType: "video", extension: ext });
      };

      mediaRecorderRef.current = mr;
      mr.start(250);
      setRecording(kind);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (err: any) {
      console.error("[IG DM] record error:", err);
      toast.error(err?.message || "Não foi possível acessar microfone/câmera");
    }
  };

  // Stop streams se o dialog fechar
  useEffect(() => {
    if (!open && recording) stopRecording(true);
  }, [open, recording, stopRecording]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-dm-send", {
        body: { username: handle, message: text, eventId, fallbackCommentId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await persistOutgoingMessage({
        messageId: (data as any)?.messageId || null,
        phone: (data as any)?.ig_user_id || igUserId,
        message: text,
        mediaType: "text",
        mediaUrl: null,
      });

      setDraft("");
      toast.success(`Enviado via ${(data as any)?.method === "private_reply" ? "Private Reply" : "DM direto"}`);
      await loadHistory();
    } catch (err: any) {
      console.error("[IG DM] send error:", err);
      toast.error(err.message || "Falha ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const cannotSendDirectly = !igUserId && !effectiveCommentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-border bg-gradient-to-r from-pink-500/10 to-purple-500/10">
          <DialogTitle className="flex items-center gap-3">
            {profilePicUrl ? (
              <img src={profilePicUrl} alt={handle} className="w-10 h-10 rounded-full object-cover border" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold">
                {handle.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-pink-500" />
                <span className="font-bold">@{handle}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-normal flex-wrap">
                {igUserId ? (
                  <Badge variant="outline" className="text-[10px]">Thread aberta</Badge>
                ) : effectiveCommentId ? (
                  <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                    Private Reply disponível
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/30">
                    Sem janela ativa
                  </Badge>
                )}
                {!fallbackCommentId && discoveredCommentInfo && (
                  <span className="text-[10px] opacity-80 truncate max-w-[260px]" title={discoveredCommentInfo.text}>
                    Comentou {discoveredCommentInfo.when}: "{discoveredCommentInfo.text.slice(0, 40)}{discoveredCommentInfo.text.length > 40 ? "…" : ""}"
                  </span>
                )}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-4" ref={scrollRef as any}>
          <div className="py-4 space-y-2">
            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
                <Info className="h-8 w-8 opacity-40" />
                <p className="text-sm">Nenhuma mensagem ainda.</p>
                <p className="text-xs">
                  {effectiveCommentId
                    ? "A primeira mensagem será enviada como Private Reply ao comentário recente."
                    : "Aguardando o usuário comentar ou mandar DM pra abrir a janela."}
                </p>
              </div>
            )}
            {messages.map((m) => {
              const isOut = m.direction === "outgoing";
              return (
                <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isOut
                      ? "bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.media_url && m.media_type?.startsWith("image") && (
                      <img src={m.media_url} alt="" className="rounded mb-1 max-w-full" />
                    )}
                    {m.media_url && m.media_type?.startsWith("video") && (
                      <video src={m.media_url} controls className="rounded mb-1 max-w-full" />
                    )}
                    {m.media_url && m.media_type?.startsWith("audio") && (
                      <audio src={m.media_url} controls className="mb-1 w-full" />
                    )}
                    {(m.message || (!m.media_url && m.media_type)) && (
                      <p className="whitespace-pre-wrap break-words">{m.message || `[${m.media_type}]`}</p>
                    )}
                    <p className={`text-[10px] mt-1 ${isOut ? "text-white/70" : "text-muted-foreground"}`}>
                      {formatTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-3 bg-card">
          {cannotSendDirectly && (
            <div className="mb-2 flex items-start gap-2 text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Sem janela ativa nem comentário recente. Aguarde o cliente comentar/enviar mensagem.</span>
            </div>
          )}
          {recording ? (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-pink-500/30 bg-pink-500/10">
              <div className="flex items-center gap-2 text-sm">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600"></span>
                </span>
                Gravando {recording === "audio" ? "áudio" : "vídeo"}…{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:
                  {String(recordSeconds % 60).padStart(2, "0")}
                </span>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => stopRecording(true)} title="Cancelar">
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => stopRecording(false)}
                  className="bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90"
                  title="Parar e enviar"
                >
                  <Square className="h-4 w-4 mr-1" /> Enviar
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Botões de mídia */}
              <div className="flex gap-1 mb-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={sending || uploading || cannotSendDirectly}
                  title="Tirar foto agora"
                >
                  <Camera className="h-4 w-4 mr-1" /> Foto
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={sending || uploading || cannotSendDirectly}
                  title="Gravar vídeo com a câmera nativa"
                >
                  <Video className="h-4 w-4 mr-1" /> Vídeo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => startRecording("audio")}
                  disabled={sending || uploading || cannotSendDirectly}
                  title="Gravar áudio na hora"
                >
                  <Mic className="h-4 w-4 mr-1" /> Áudio
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => startRecording("video")}
                  disabled={sending || uploading || cannotSendDirectly}
                  title="Gravar vídeo na hora (webcam)"
                >
                  <Video className="h-4 w-4 mr-1" /> Gravar vídeo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 ml-auto"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={sending || uploading || cannotSendDirectly}
                  title="Anexar da galeria"
                >
                  <Paperclip className="h-4 w-4 mr-1" /> Galeria
                </Button>
              </div>

              {/* Inputs ocultos */}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelected} />
              <input ref={videoInputRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={handleFileSelected} />
              <input ref={galleryInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleFileSelected} />

              <div className="flex gap-2 items-end">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  className="min-h-[60px] max-h-[120px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={sending || uploading || cannotSendDirectly}
                />
                <Button
                  onClick={handleSend}
                  disabled={!draft.trim() || sending || uploading || cannotSendDirectly}
                  className="bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90"
                >
                  {sending || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
