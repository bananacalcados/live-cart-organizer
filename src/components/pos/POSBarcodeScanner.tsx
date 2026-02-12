import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    let mounted = true;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");

        if (!mounted || !scannerRef.current) return;

        const scannerId = "pos-barcode-scanner";
        // Ensure the element exists
        if (!document.getElementById(scannerId)) {
          const div = document.createElement("div");
          div.id = scannerId;
          scannerRef.current.appendChild(div);
        }

        const scanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 120 },
            aspectRatio: 1.5,
          },
          (decodedText: string) => {
            // On successful scan
            onScan(decodedText);
            scanner.stop().catch(() => {});
            onClose();
          },
          () => {
            // Ignore scan failures (no code found in frame)
          }
        );

        if (mounted) setStarting(false);
      } catch (err: any) {
        console.error("Camera error:", err);
        if (mounted) {
          setStarting(false);
          if (err?.toString?.().includes("NotAllowedError")) {
            setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
          } else if (err?.toString?.().includes("NotFoundError")) {
            setError("Nenhuma câmera encontrada neste dispositivo.");
          } else {
            setError("Não foi possível iniciar a câmera. Verifique as permissões.");
          }
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current.clear().catch(() => {});
        html5QrCodeRef.current = null;
      }
    };
  }, [onScan, onClose]);

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
          <div ref={scannerRef} className="w-full [&_video]:!rounded-xl [&_#pos-barcode-scanner]:!border-0" />
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
