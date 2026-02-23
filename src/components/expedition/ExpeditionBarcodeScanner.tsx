import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, AlertTriangle, RotateCcw, ScanBarcode, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExpeditionBarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function ExpeditionBarcodeScanner({ onScan, onClose }: ExpeditionBarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const scannedRef = useRef(false);
  const mountedRef = useRef(true);

  // Manual photo capture state
  const [captured, setCaptured] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stopScanner = useCallback(async () => {
    const scanner = html5QrCodeRef.current;
    if (!scanner) return;
    html5QrCodeRef.current = null;
    try {
      const state = scanner.getState?.();
      if (state === 2 || state === 3) {
        await scanner.stop();
      }
    } catch {
      // ignore
    }
    try {
      scanner.clear();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    scannedRef.current = false;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !mountedRef.current || !scannerRef.current) return;

        const scannerId = "expedition-barcode-scanner-" + Date.now();
        const div = document.createElement("div");
        div.id = scannerId;
        scannerRef.current.appendChild(div);

        const scanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 120 }, aspectRatio: 1.5 },
          (decodedText: string) => {
            if (scannedRef.current || !mountedRef.current) return;
            scannedRef.current = true;

            stopScanner().finally(() => {
              if (mountedRef.current) {
                onScanRef.current(decodedText);
              }
              setTimeout(() => {
                onCloseRef.current();
              }, 100);
            });
          },
          () => {
            // no code in frame
          }
        );

        if (mountedRef.current && !cancelled) setStarting(false);
      } catch (err: any) {
        console.error("Camera error:", err);
        if (mountedRef.current && !cancelled) {
          setStarting(false);
          const msg = err?.toString?.() || "";
          if (msg.includes("NotAllowedError")) {
            setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
          } else if (msg.includes("NotFoundError")) {
            setError("Nenhuma câmera encontrada neste dispositivo.");
          } else {
            setError("Não foi possível iniciar a câmera. Verifique as permissões.");
          }
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      stopScanner();
    };
  }, []);

  const takePhoto = useCallback(async () => {
    const scanner = html5QrCodeRef.current;
    if (!scanner) return;

    try {
      // Pause live scanning, grab a frame from the video
      const videoEl = scannerRef.current?.querySelector("video");
      if (!videoEl) return;

      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

      // Stop live scanner so it doesn't interfere
      await stopScanner();
      setCaptured(dataUrl);
      setScanFailed(false);
      setScanning(true);

      // Try to decode the captured image
      const { Html5Qrcode } = await import("html5-qrcode");

      // Need a hidden div for the file scanner
      let hiddenDiv = document.getElementById("expedition-photo-scanner-hidden");
      if (!hiddenDiv) {
        hiddenDiv = document.createElement("div");
        hiddenDiv.id = "expedition-photo-scanner-hidden";
        hiddenDiv.style.display = "none";
        document.body.appendChild(hiddenDiv);
      }

      const fileScanner = new Html5Qrcode("expedition-photo-scanner-hidden");
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
      const result = await fileScanner.scanFile(file, false);
      fileScanner.clear();

      if (result && mountedRef.current) {
        scannedRef.current = true;
        onScanRef.current(result);
        setTimeout(() => onCloseRef.current(), 100);
      }
    } catch {
      if (mountedRef.current) {
        setScanning(false);
        setScanFailed(true);
      }
    }
  }, [stopScanner]);

  const retake = useCallback(() => {
    setCaptured(null);
    setScanning(false);
    setScanFailed(false);
    scannedRef.current = false;

    // Restart live scanner
    const startAgain = async () => {
      if (!scannerRef.current || !mountedRef.current) return;
      setStarting(true);
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scannerId = "expedition-barcode-scanner-" + Date.now();
        const div = document.createElement("div");
        div.id = scannerId;
        // Clear previous children
        scannerRef.current.innerHTML = "";
        scannerRef.current.appendChild(div);

        const scanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 120 }, aspectRatio: 1.5 },
          (decodedText: string) => {
            if (scannedRef.current || !mountedRef.current) return;
            scannedRef.current = true;
            stopScanner().finally(() => {
              if (mountedRef.current) onScanRef.current(decodedText);
              setTimeout(() => onCloseRef.current(), 100);
            });
          },
          () => {}
        );
        if (mountedRef.current) setStarting(false);
      } catch {
        if (mountedRef.current) setStarting(false);
      }
    };
    startAgain();
  }, [stopScanner]);

  return (
    <div className="space-y-3">
      {error ? (
        <div className="aspect-video bg-muted rounded-xl flex items-center justify-center border border-destructive/30 p-4">
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-destructive" />
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
          {scanFailed && !scanning && (
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
          <div ref={scannerRef} className="w-full [&_video]:!rounded-xl [&_video]:!object-cover" />
          {!starting && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <button
                onClick={takePhoto}
                className="h-16 w-16 rounded-full bg-white border-4 border-primary shadow-lg active:scale-90 transition-transform flex items-center justify-center"
                aria-label="Fotografar código de barras"
              >
                <Camera className="h-7 w-7 text-primary" />
              </button>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-center text-muted-foreground">
        O scanner automático está ativo. Toque no botão da câmera para capturar manualmente.
      </p>
      <Button className="w-full" variant="outline" onClick={onClose}>
        Fechar
      </Button>
    </div>
  );
}
