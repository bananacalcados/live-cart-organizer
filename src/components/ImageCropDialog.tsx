import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, Loader2 } from "lucide-react";

interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  /** Aspect ratio (width/height). Default 1 (square, WhatsApp carousel thumbnail). */
  aspect?: number;
  /** Output edge size in px. Default 1024. */
  outputSize?: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
}

async function getCroppedBlob(
  imageSrc: string,
  cropPixels: Area,
  outputSize: number,
  aspect: number,
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = imageSrc;
  });

  const outW = outputSize;
  const outH = Math.round(outputSize / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context unavailable");

  // White background so transparent PNGs don't turn black on JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outW,
    outH,
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.9,
    );
  });
}

/**
 * Recorte humano da imagem para a proporção da miniatura do card do WhatsApp (1:1).
 * Arraste para reposicionar, use o zoom para enquadrar o produto. Exporta JPEG 1024×1024.
 */
export function ImageCropDialog({
  open,
  imageSrc,
  aspect = 1,
  outputSize = 1024,
  loading = false,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_a: Area, areaPixels: Area) => {
    setCropPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !cropPixels) return;
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, cropPixels, outputSize, aspect);
      await onConfirm(blob);
    } finally {
      setProcessing(false);
    }
  };

  const busy = loading || processing;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar imagem do card (miniatura 1:1)</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Arraste a imagem e use o zoom para centralizar o produto. O WhatsApp mostra a miniatura
          do card em quadrado (1:1) — assim ela não fica cortada para o cliente.
        </p>

        <div className="relative w-full aspect-square bg-muted rounded-md overflow-hidden">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
            />
          )}
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0])}
            className="flex-1"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={busy || !cropPixels}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Usar imagem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
