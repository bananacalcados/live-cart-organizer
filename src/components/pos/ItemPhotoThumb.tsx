import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ItemPhoto } from "@/lib/pos/itemPhotoCache";

/** Fixed-size thumbnail; grey square while loading/missing/failed; click enlarges. */
export function ItemPhotoThumb({ photo, size = 40, alt = "", medium = false }: { photo: ItemPhoto | null; size?: number; alt?: string; medium?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = photo && !failed ? (medium ? photo.medium : photo.thumb) : null;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); if (src) setOpen(true); }}
        className="shrink-0 overflow-hidden rounded-md bg-muted" style={{ width: size, height: size }}
        aria-label={src ? `Ampliar foto ${alt}` : "Sem foto"} tabIndex={src ? 0 : -1}>
        {src && <img src={src} alt={alt} loading="lazy" decoding="async" width={size} height={size}
          className="h-full w-full object-cover" onError={() => setFailed(true)} />}
      </button>
      {open && photo && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl p-2">
            <DialogTitle className="sr-only">{alt || "Foto do produto"}</DialogTitle>
            <img src={photo.full} alt={alt} className="max-h-[80vh] w-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
