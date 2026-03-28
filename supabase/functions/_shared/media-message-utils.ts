const MEDIA_PLACEHOLDER_REGEX = /^\s*(?:📎\s*)?(?:\[(?:áudio|audio|imagem|image|foto|photo|vídeo|video|documento|document|arquivo|file|figurinha|sticker)\]|(?:áudio|audio|imagem|image|foto|photo|vídeo|video|documento|document|arquivo|file|figurinha|sticker))\s*$/iu;

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
