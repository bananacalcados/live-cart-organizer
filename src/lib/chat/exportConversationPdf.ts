import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface ExportMessage {
  id: string;
  message: string | null;
  direction: string;
  created_at: string;
  media_type?: string | null;
  media_url?: string | null;
  status?: string | null;
  sender_name?: string | null;
}

export interface ExportMeta {
  contactName: string;
  phone: string;
  instanceLabel?: string | null;
  periodLabel: string;
}

/** Escape text for safe HTML injection. */
function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

/** Fetch an image URL and convert to a data URL so html2canvas can render it (avoids CORS taint). */
async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** SHA-256 hex digest of a string (integrity hash for the legal cover). */
async function sha256Hex(text: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "indisponível";
  }
}

const MEDIA_LABELS: Record<string, { icon: string; label: string }> = {
  audio: { icon: "🎤", label: "Áudio" },
  video: { icon: "🎬", label: "Vídeo" },
  ig_reel: { icon: "🎬", label: "Reel" },
  ig_story: { icon: "📸", label: "Story" },
  story: { icon: "📸", label: "Story" },
  story_mention: { icon: "📸", label: "Menção em Story" },
  ig_post: { icon: "🖼️", label: "Publicação" },
  document: { icon: "📎", label: "Documento" },
  file: { icon: "📎", label: "Arquivo" },
  share: { icon: "🔗", label: "Compartilhado" },
  template: { icon: "📋", label: "Mensagem modelo" },
};

function fileNameFromUrl(url?: string | null): string {
  if (!url) return "";
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").trim();
    return name;
  } catch {
    return "";
  }
}

/** Build the WhatsApp-styled HTML for one message bubble. */
function renderBubble(
  msg: ExportMessage,
  imageMap: Map<string, string>,
): string {
  const isOut = msg.direction === "outgoing";
  const time = format(new Date(msg.created_at), "HH:mm");
  const type = (msg.media_type || "text").toLowerCase();
  const cleanText = (msg.message || "").replace(/^\[AUTO\]\s*/, "");

  let inner = "";

  if (type === "image" && msg.media_url) {
    const dataUrl = imageMap.get(msg.media_url);
    if (dataUrl) {
      inner += `<img src="${dataUrl}" style="max-width:230px;max-height:230px;border-radius:6px;display:block;margin-bottom:4px;object-fit:cover;"/>`;
    } else {
      inner += mediaMarker("🖼️", "Imagem", msg.media_url);
    }
    if (cleanText && !cleanText.startsWith("[")) {
      inner += `<div>${esc(cleanText)}</div>`;
    }
  } else if (MEDIA_LABELS[type]) {
    const m = MEDIA_LABELS[type];
    inner += mediaMarker(m.icon, m.label, msg.media_url);
    if (cleanText && !cleanText.startsWith("[")) {
      inner += `<div style="margin-top:4px;">${esc(cleanText)}</div>`;
    }
  } else {
    inner += `<div>${esc(cleanText || "")}</div>`;
  }

  const senderName =
    isOut && msg.sender_name
      ? `<div style="font-size:11px;font-weight:600;color:#7c57d1;margin-bottom:2px;">${esc(msg.sender_name)}</div>`
      : "";

  const bg = isOut ? "#dcf8c6" : "#ffffff";
  const align = isOut ? "flex-end" : "flex-start";

  return `
    <div style="display:flex;justify-content:${align};margin-bottom:6px;">
      <div style="max-width:75%;background:${bg};border-radius:8px;padding:6px 9px;font-size:14px;color:#111b21;box-shadow:0 1px 0.5px rgba(0,0,0,0.13);word-break:break-word;overflow-wrap:anywhere;">
        ${senderName}
        ${inner}
        <div style="font-size:10px;color:#667781;text-align:right;margin-top:2px;">${time}</div>
      </div>
    </div>`;
}

function mediaMarker(icon: string, label: string, url?: string | null): string {
  const name = fileNameFromUrl(url);
  const sub = name ? `<div style="font-size:10px;color:#667781;">${esc(name)}</div>` : "";
  const link = url
    ? `<div style="font-size:9px;color:#3b7ddd;word-break:break-all;margin-top:2px;">${esc(url)}</div>`
    : "";
  return `
    <div style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:8px 10px;margin-bottom:2px;">
      <div style="font-size:22px;line-height:1;">${icon}</div>
      <div style="min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#111b21;">${label}</div>
        ${sub}
        ${link}
      </div>
    </div>`;
}

function dateSeparator(date: Date): string {
  const label = format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  return `
    <div style="display:flex;justify-content:center;margin:12px 0;">
      <div style="background:#e1f2fb;color:#54656f;font-size:11px;font-weight:500;padding:4px 12px;border-radius:8px;">${label}</div>
    </div>`;
}

/** Generate and download the conversation PDF. */
export async function exportConversationPdf(
  messages: ExportMessage[],
  meta: ExportMeta,
  opts: { includeImages: boolean; onProgress?: (msg: string) => void } = { includeImages: true },
): Promise<void> {
  const { onProgress } = opts;

  // 1. Preload images as data URLs (respecting the includeImages flag).
  const imageMap = new Map<string, string>();
  if (opts.includeImages) {
    const imageUrls = Array.from(
      new Set(
        messages
          .filter((m) => (m.media_type || "").toLowerCase() === "image" && m.media_url)
          .map((m) => m.media_url as string),
      ),
    );
    for (let i = 0; i < imageUrls.length; i++) {
      onProgress?.(`Carregando imagens ${i + 1}/${imageUrls.length}...`);
      const data = await fetchImageDataUrl(imageUrls[i]);
      if (data) imageMap.set(imageUrls[i], data);
    }
  }

  onProgress?.("Montando documento...");

  // 2. Build body HTML with date separators.
  let body = "";
  let prevDate: Date | null = null;
  for (const msg of messages) {
    const d = new Date(msg.created_at);
    if (!prevDate || !isSameDay(d, prevDate)) {
      body += dateSeparator(d);
    }
    body += renderBubble(msg, imageMap);
    prevDate = d;
  }

  // 3. Integrity hash over the textual transcript.
  const transcript = messages
    .map((m) => `${m.created_at}|${m.direction}|${m.media_type || "text"}|${m.message || ""}`)
    .join("\n");
  const hash = await sha256Hex(transcript);

  const generatedAt = format(new Date(), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR });

  const cover = `
    <div style="padding:24px 28px;border:1px solid #d1d7db;border-radius:10px;background:#ffffff;margin-bottom:20px;">
      <div style="font-size:20px;font-weight:700;color:#111b21;margin-bottom:4px;">Registro de Conversa — WhatsApp</div>
      <div style="font-size:12px;color:#667781;margin-bottom:16px;">Documento gerado para fins de comprovação</div>
      <table style="font-size:13px;color:#111b21;border-collapse:collapse;">
        <tr><td style="padding:3px 12px 3px 0;color:#667781;">Contato:</td><td style="font-weight:600;">${esc(meta.contactName)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667781;">Telefone:</td><td>${esc(meta.phone)}</td></tr>
        ${meta.instanceLabel ? `<tr><td style="padding:3px 12px 3px 0;color:#667781;">Número/Instância:</td><td>${esc(meta.instanceLabel)}</td></tr>` : ""}
        <tr><td style="padding:3px 12px 3px 0;color:#667781;">Período:</td><td>${esc(meta.periodLabel)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667781;">Total de mensagens:</td><td>${messages.length}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667781;">Gerado em:</td><td>${generatedAt}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667781;vertical-align:top;">Hash SHA-256:</td><td style="font-family:monospace;font-size:10px;word-break:break-all;max-width:420px;">${hash}</td></tr>
      </table>
    </div>`;

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "760px";
  container.style.padding = "16px";
  container.style.background = "#e5ddd5";
  container.style.fontFamily = "'Segoe UI', Helvetica, Arial, sans-serif";
  container.innerHTML = cover + body;
  document.body.appendChild(container);

  try {
    onProgress?.("Renderizando páginas...");
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#e5ddd5",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const imgW = pageW;
    const scaleRatio = imgW / canvas.width;
    const pageCanvasHeight = Math.floor(pageH / scaleRatio); // source px per page

    let renderedHeight = 0;
    let pageIndex = 0;
    while (renderedHeight < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - renderedHeight);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#e5ddd5";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          renderedHeight,
          canvas.width,
          sliceHeight,
          0,
          0,
          canvas.width,
          sliceHeight,
        );
      }
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, imgW, sliceHeight * scaleRatio);

      // Footer with page number + contact
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        `${meta.contactName} — ${meta.phone}`,
        20,
        pageH - 12,
      );
      renderedHeight += sliceHeight;
      pageIndex++;
    }

    // Page numbers (X de Y)
    const total = pdf.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      pdf.setPage(p);
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(`Página ${p} de ${total}`, pageW - 90, pageH - 12);
    }

    const safeName = meta.contactName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "conversa";
    pdf.save(`Conversa-${safeName}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
