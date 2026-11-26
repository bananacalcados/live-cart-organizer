import { PHOTO_ACCEPT } from "@/lib/productPhotos";

export const RESIZE_MAX_SIDE = 2560;
export const RESIZE_QUALITY = 0.85;
export const MOBILE_FORMAT_ERROR = "Formato não aceito, use a câmera ou a galeria";

export function isAcceptedPhotoType(type: string) { return PHOTO_ACCEPT.includes(type); }

export function targetSize(w: number, h: number, max = RESIZE_MAX_SIDE) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** Reduces on the device (EXIF orientation applied, max side 2560, JPEG 0.85); returns the original if anything fails. */
export async function resizeForUpload(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
    const { width, height } = targetSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close?.();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", RESIZE_QUALITY));
    if (!blob || !blob.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}
