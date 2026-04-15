import { useState } from "react";
import { AudioPlayer } from "./AudioPlayer";
import { ExternalLink, FileText, Paperclip, X, ZoomIn, ZoomOut, Download } from "lucide-react";

interface WhatsAppMediaAttachmentProps {
  mediaUrl?: string | null;
  mediaType?: string | null;
  message?: string | null;
  imageClassName?: string;
  imageStyle?: React.CSSProperties;
  videoClassName?: string;
  videoStyle?: React.CSSProperties;
  audioClassName?: string;
  pdfClassName?: string;
  documentClassName?: string;
}

function getAttachmentName(mediaUrl?: string | null, message?: string | null) {
  if (message?.trim() && !message.startsWith("[")) return message.trim();
  if (!mediaUrl) return "Arquivo";

  try {
    const pathname = new URL(mediaUrl).pathname;
    const name = decodeURIComponent(pathname.split("/").pop() || "").trim();
    return name || "Arquivo";
  } catch {
    const name = decodeURIComponent(mediaUrl.split("?")[0]?.split("/").pop() || "").trim();
    return name || "Arquivo";
  }
}

function isPdfAttachment(mediaUrl?: string | null, mediaType?: string | null, message?: string | null) {
  const normalizedType = (mediaType || "").toLowerCase();
  const normalizedMessage = (message || "").toLowerCase();
  const normalizedUrl = (mediaUrl || "").toLowerCase().split("?")[0];

  return normalizedType.includes("pdf")
    || (normalizedType === "document" && normalizedUrl.endsWith(".pdf"))
    || normalizedUrl.endsWith(".pdf")
    || normalizedMessage.endsWith(".pdf");
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-end gap-2 p-3 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.5, z - 0.25)); }}
          className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(4, z + 0.25)); }}
          className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={onClose}
          className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image */}
      <div
        className="overflow-auto max-h-[90vh] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="transition-transform duration-200 ease-out"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', maxHeight: '85vh', objectFit: 'contain' }}
          draggable={false}
        />
      </div>
    </div>
  );
}

export function WhatsAppMediaAttachment({
  mediaUrl,
  mediaType,
  message,
  imageClassName = "max-w-full rounded-lg mb-1",
  imageStyle,
  videoClassName = "max-w-full rounded-lg mb-1",
  videoStyle,
  audioClassName = "w-full mb-1",
  pdfClassName = "w-full h-64 rounded-md border border-border bg-background mb-2",
  documentClassName = "mb-1 rounded-md border border-border bg-muted/40 p-3",
}: WhatsAppMediaAttachmentProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!mediaUrl || mediaType === "text") return null;

  const attachmentName = getAttachmentName(mediaUrl, message);
  const isPdf = isPdfAttachment(mediaUrl, mediaType, message);

  if (mediaType?.includes("image") || mediaType === "image") {
    return (
      <>
        <img
          src={mediaUrl}
          alt={attachmentName}
          className={`${imageClassName} cursor-pointer hover:opacity-90 transition-opacity`}
          style={imageStyle}
          onClick={() => setLightboxOpen(true)}
        />
        {lightboxOpen && (
          <ImageLightbox src={mediaUrl} alt={attachmentName} onClose={() => setLightboxOpen(false)} />
        )}
      </>
    );
  }

  if (mediaType === "video") {
    return <video src={mediaUrl} controls className={videoClassName} style={videoStyle} />;
  }

  if (mediaType === "audio") {
    return <audio src={mediaUrl} controls className={audioClassName} />;
  }

  if (isPdf) {
    return (
      <div className="mb-2 space-y-2">
        <iframe
          src={mediaUrl}
          title={attachmentName}
          className={pdfClassName}
        />
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-xs text-foreground">{attachmentName}</span>
          </div>
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Abrir <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={documentClassName}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-xs text-foreground">{attachmentName}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
          Abrir <ExternalLink className="h-3 w-3" />
        </span>
      </div>
    </a>
  );
}
