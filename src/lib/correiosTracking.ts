export const correiosTrackingUrl = (code: string) => `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
