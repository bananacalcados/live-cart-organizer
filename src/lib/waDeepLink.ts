/**
 * Mesmo mecanismo de abertura do WhatsApp usado no /zap:
 * - Android dentro do Instagram/Facebook: intent:// direto no app do WhatsApp.
 * - iOS dentro do Instagram: webview nem sempre abre → devolve "manual" (mostrar botão).
 * - Navegador comum: navega para o link.
 */
export function openWhatsAppDeepLink(target: string, ua: string = navigator.userAgent): "opened" | "manual" {
  const isInApp = /Instagram|FBAN|FBAV/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  if (isAndroid && isInApp) {
    window.location.href = `intent://${target.replace("https://", "")}#Intent;scheme=https;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(target)};end`;
    return "opened";
  }
  if (isInApp) return "manual";
  window.location.href = target;
  return "opened";
}
