import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, Loader2, RotateCcw, ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CapturePhotoScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function CapturePhotoScanner({ onScan, onClose }: CapturePhotoScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [captured, setCaptured] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const mountedRef = useRef(true);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled || !mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (mountedRef.current) setStarting(false);
      } catch (err: any) {
        if (!mountedRef.current) return;
        setStarting(false);
        const msg = err?.toString?.() || "";
        if (msg.includes("NotAllowedError")) setError("Permissão da câmera negada.");
        else if (msg.includes("NotFoundError")) setError("Nenhuma câmera encontrada.");
        else setError("Não foi possível iniciar a câmera.");
      }
    };

    start();
    return () => { cancelled = true; mountedRef.current = false; stopCamera(); };
  }, [stopCamera]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCaptured(dataUrl);
    // Don't stop camera yet in case they want to retake
  }, []);

  const retake = useCallback(() => {
    setCaptured(null);
    setScanning(false);
  }, []);

  const scanPhoto = useCallback(async () => {
    if (!captured) return;
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");

      // Convert data URL to File
      const res = await fetch(captured);
      const blob = await res.blob();
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });

      const scanner = new Html5Qrcode("capture-scanner-hidden");
      const result = await scanner.scanFile(file, /* showImage */ false);
      scanner.clear();

      if (result && mountedRef.current) {
        stopCamera();
        onScan(result);
        onClose();
      }
    } catch {
      if (mountedRef.current) {
        setScanning(false);
        // Could not detect barcode — keep captured image so user can retake
        // We'll show an inline message
      }
    }
  }, [captured, onScan, onClose, stopCamera]);

  // Auto-scan when photo is captured
  useEffect(() => {
    if (captured && !scanning) {
      scanPhoto();
    }
  }, [captured]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* Hidden div for Html5Qrcode file scanner */}
      <div id="capture-scanner-hidden" className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      {error ? (
        <div className="aspect-video bg-muted rounded-xl flex items-center justify-center border border-destructive/30 p-4">
          <div className="text-center">
            <Camera className="h-10 w-10 mx-auto mb-2 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      ) : captured ? (
        <div className="relative rounded-xl overflow-hidden border border-primary/30">
          <img src={captured} alt="Foto capturada" className="w-full rounded-xl" />
          {scanning && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium">Escaneando código de barras...</p>
              </div>
            </div>
          )}
          {!scanning && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <div className="text-center space-y-3 p-4">
                <ScanBarcode className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">Código de barras não detectado na foto.</p>
                <p className="text-xs text-muted-foreground">
                  Tente fotografar mais perto do código de barras.
                </p>
                <Button onClick={retake} variant="secondary" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Tirar outra foto
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-primary/20">
          {starting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <div className="text-center text-muted-foreground">
                <Camera className="h-10 w-10 mx-auto mb-2 animate-pulse" />
                <p className="text-sm">Iniciando câmera...</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            className="w-full rounded-xl"
            playsInline
            muted
            autoPlay
          />
          {!starting && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <button
                onClick={takePhoto}
                className="h-16 w-16 rounded-full bg-white border-4 border-primary shadow-lg active:scale-90 transition-transform flex items-center justify-center"
                aria-label="Fotografar"
              >
                <Camera className="h-7 w-7 text-primary" />
              </button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-center text-muted-foreground">
        Aponte a câmera para a etiqueta e toque no botão para fotografar
      </p>
      <Button variant="outline" className="w-full" onClick={() => { stopCamera(); onClose(); }}>
        Fechar
      </Button>
    </div>
  );
}
