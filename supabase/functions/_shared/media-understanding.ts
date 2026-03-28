function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function sniffMimeType(bytes: Uint8Array, fallback = "application/octet-stream"): string {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  }

  return fallback;
}

function isSupportedAttachment(mimeType: string, declaredMediaType?: string | null): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf" || declaredMediaType === "image" || declaredMediaType === "document";
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    data: match[2],
  };
}

async function runAnthropicAttachmentAnalysis(
  mimeType: string,
  base64Data: string,
  promptContext: string,
): Promise<string | null> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) return null;

  const attachmentBlock = mimeType === "application/pdf"
    ? {
        type: "document",
        source: {
          type: "base64",
          media_type: mimeType,
          data: base64Data,
        },
        title: "documento-enviado-pelo-cliente.pdf",
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: base64Data,
        },
      };

  const analysisPrompt = `Analise o anexo enviado por um cliente no WhatsApp. Faça leitura REAL do conteúdo visual/documental, não invente nada.

Contexto da mensagem atual do cliente:
${promptContext || "(sem texto adicional)"}

Responda em português do Brasil com estes blocos:
RESUMO:
- explique objetivamente o que é o anexo e o que ele mostra.

TEXTO_VISÍVEL:
- copie fielmente todo texto legível relevante (OCR), preservando números, nomes, CPF, pedidos, rastreios, datas, valores, links e códigos.

DADOS_IMPORTANTES:
- liste os dados-chave extraídos.

INTENÇÃO_PROVÁVEL:
- diga o que o cliente provavelmente quer que o atendente entenda ou faça com esse anexo.

Se algo estiver ilegível, diga explicitamente o que não deu para ler.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: [
          attachmentBlock,
          { type: "text", text: analysisPrompt },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[media-understanding] Anthropic analysis error ${response.status}: ${errorText.slice(0, 300)}`);
    return null;
  }

  const data = await response.json();
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
    .map((block: any) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || null;
}

export async function analyzeIncomingAttachment({
  mediaUrl,
  mediaType,
  promptContext,
}: {
  mediaUrl: string;
  mediaType?: string | null;
  promptContext: string;
}): Promise<{ analysis: string | null; inlineDataUrl: string | null; mimeType: string; mediaKind: "image" | "document" | "unsupported" }> {
  const response = await fetch(mediaUrl);

  if (!response.ok) {
    throw new Error(`Não foi possível baixar o anexo (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("O anexo baixado veio vazio");
  }

  const responseMime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  const mimeType = sniffMimeType(bytes, responseMime);

  if (!isSupportedAttachment(mimeType, mediaType)) {
    return {
      analysis: null,
      inlineDataUrl: null,
      mimeType,
      mediaKind: "unsupported",
    };
  }

  const base64Data = uint8ToBase64(bytes);
  const inlineDataUrl = mimeType.startsWith("image/") ? `data:${mimeType};base64,${base64Data}` : null;
  const analysis = await runAnthropicAttachmentAnalysis(mimeType, base64Data, promptContext);

  return {
    analysis,
    inlineDataUrl,
    mimeType,
    mediaKind: mimeType.startsWith("image/") ? "image" : "document",
  };
}