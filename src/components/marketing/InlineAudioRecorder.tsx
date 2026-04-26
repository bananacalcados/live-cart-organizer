import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Trash2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getAudioMimeType, getAudioExtension, getAudioContentType } from "@/lib/audioRecorder";

interface InlineAudioRecorderProps {
  onUpload: (file: File) => Promise<void> | void;
  uploading?: boolean;
}

export function InlineAudioRecorder({ onUpload, uploading }: InlineAudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopTimer();
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    try {
      setBusy(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = getAudioMimeType();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const usedMime = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: getAudioContentType(usedMime) });
        const url = URL.createObjectURL(blob);
        setPreviewBlob(blob);
        setPreviewUrl(url);
        stopStream();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível acessar o microfone");
    } finally {
      setBusy(false);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    stopTimer();
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setPlaying(false);
    setElapsed(0);
  }

  async function handleUpload() {
    if (!previewBlob) return;
    const mime = previewBlob.type || "audio/webm";
    const ext = getAudioExtension(mime);
    const file = new File([previewBlob], `gravacao-${Date.now()}.${ext}`, { type: mime });
    await onUpload(file);
    discard();
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const r = (s % 60).toString().padStart(2, "0");
    return `${m}:${r}`;
  }

  if (previewUrl) {
    return (
      <div className="flex items-center gap-2 border rounded px-2 py-1 bg-muted/40">
        <Button type="button" size="sm" variant="ghost" onClick={togglePlay} className="h-7 w-7 p-0">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <audio
          ref={audioRef}
          src={previewUrl}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
        <span className="text-xs text-muted-foreground flex-1">Gravação pronta ({fmt(elapsed)})</span>
        <Button type="button" size="sm" variant="ghost" onClick={discard} className="h-7 w-7 p-0" disabled={uploading}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <Button type="button" size="sm" onClick={handleUpload} disabled={uploading} className="h-7">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Usar
        </Button>
      </div>
    );
  }

  if (recording) {
    return (
      <Button type="button" size="sm" variant="destructive" onClick={stopRecording} className="h-9">
        <Square className="h-4 w-4 mr-1" /> Parar ({fmt(elapsed)})
      </Button>
    );
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={startRecording} disabled={busy} className="h-9">
      {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mic className="h-4 w-4 mr-1" />}
      Gravar
    </Button>
  );
}
