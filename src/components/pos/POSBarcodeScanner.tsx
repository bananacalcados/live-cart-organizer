import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface POSBarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function POSBarcodeScanner({ onScan, onClose }: POSBarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const scannedRef = useRef(false);
  const mountedRef = useRef(true);

  // Stable refs for callbacks to avoid re-triggering useEffect
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
      // 2 = SCANNING, 3 = PAUSED
      if (state === 2 || state === 3) {
        await scanner.stop();
      }
    } catch {
      // ignore stop errors
    }
    try {
      scanner.clear();
    } catch {
      // ignore clear errors
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

        const scannerId = "pos-barcode-scanner-" + Date.now();
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

            // Stop scanner first, then notify parent after a tick
            stopScanner().finally(() => {
              if (mountedRef.current) {
                onScanRef.current(decodedText);
              }
              // Delay close to let React process the scan result
              setTimeout(() => {
                onCloseRef.current();
              }, 100);
            });
          },
          () => {
            // no code in frame – ignore
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
  }, []); // no deps – start once only

  return (
    <div className="space-y-3">
      {error ? (
        <div className="aspect-video bg-pos-white/5 rounded-xl flex items-center justify-center border border-red-500/30 p-4">
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-pos-orange/20">
          {starting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-pos-black/80">
              <div className="text-center text-pos-white/60">
                <Camera className="h-10 w-10 mx-auto mb-2 animate-pulse" />
                <p className="text-sm">Iniciando câmera...</p>
              </div>
            </div>
          )}
          <div ref={scannerRef} className="w-full [&_video]:!rounded-xl [&_video]:!object-cover" />
        </div>
      )}
      <p className="text-xs text-center text-pos-white/40">Aponte a câmera para o código de barras do produto</p>
      <Button
        className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
        onClick={onClose}
      >
        Fechar
      </Button>
    </div>
  );
}
