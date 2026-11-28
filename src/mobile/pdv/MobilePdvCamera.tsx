import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MobilePdvCamera({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const read = useRef(onScan); read.current = onScan;
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | undefined;
    let last = ""; let lastAt = 0;
    void (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (!host.current || cancelled) return;
        host.current.id = `pdv-camera-${crypto.randomUUID()}`;
        scanner = new Html5Qrcode(host.current.id, { formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 120 } }, code => {
          if (cancelled || (code === last && Date.now() - lastAt < 2000)) return;
          last = code; lastAt = Date.now(); read.current(code);
        }, () => {});
        if (cancelled) await scanner.stop();
      } catch { if (!cancelled) setError("Não consegui abrir a câmera. Confira a permissão ou use o leitor."); }
    })();
    return () => { cancelled = true; if (scanner?.isScanning) void scanner.stop().catch(() => {}); };
  }, []);
  return <section className="space-y-2">
    <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Camera className="h-5 w-5" />Câmera</span><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fechar câmera" onClick={onClose}><X className="h-5 w-5" /></Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div ref={host} className="min-h-40 w-full overflow-hidden rounded-md bg-muted [&_video]:max-w-full" />
  </section>;
}