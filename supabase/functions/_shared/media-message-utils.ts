const MEDIA_PLACEHOLDER_REGEX = /^\s*(?:📎\s*)?(?:\[(?:áudio|audio|imagem|image|foto|photo|vídeo|video|documento|document|arquivo|file|figurinha|sticker)\]|(?:áudio|audio|imagem|image|foto|photo|vídeo|video|documento|document|arquivo|file|figurinha|sticker))\s*$/iu;
const VISUAL_REFERENCE_REGEX = /\b(?:foto|imagem|print|anexo|arquivo|documento|pdf|comprovante|boleto|isso|isto|esse|essa|aquilo|viu|ver|mostrei|mandei|te mandei)\b/iu;

export function sanitizeMediaPlaceholderText(value?: string | null): string {
  const text = value?.trim() || '';
  return MEDIA_PLACEHOLDER_REGEX.test(text) ? '' : text;
}

export function joinMeaningfulMessages(messages: Array<{ message?: string | null }>): string {
  return messages
    .map((message) => sanitizeMediaPlaceholderText(message.message))
    .filter(Boolean)
    .join('\n');
}

export function isVisualReferenceMessage(value?: string | null): boolean {
  const text = value?.trim() || '';
  return VISUAL_REFERENCE_REGEX.test(text);
}
