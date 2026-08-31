// Decodifica e persiste XML/DANFE devolvidos em base64 pela BrasilNFe.
// Usado na emissão de NF-e/NFC-e, no poll da SEFAZ, no retry de contingência
// e no backfill de notas antigas.

export function buildRenderableDanfeUrl(url: string | null | undefined) {
  if (!url || !/\.html(?:$|[?#])/i.test(url)) return url || null;
  const endpoint = new URL("/functions/v1/fiscal-render-document", Deno.env.get("SUPABASE_URL")!);
  endpoint.searchParams.set("url", url);
  return endpoint.toString();
}

export interface FiscalFileResult {
  xml_content?: string;
  danfe_url?: string;
}

/**
 * Extrai Base64Xml -> xml_content e Base64File -> storage (bucket fiscal-documents),
 * devolvendo os campos que devem ser gravados em fiscal_documents.
 * Nunca lança: em caso de erro devolve o que conseguiu extrair.
 */
export async function persistFiscalFiles(
  supabase: any,
  resp: any,
  chave: string | null | undefined,
): Promise<FiscalFileResult> {
  const out: FiscalFileResult = {};
  if (!resp) return out;

  const b64Xml = resp.Base64Xml || resp.base64Xml || resp.Base64XML || null;
  const b64File = resp.Base64File || resp.base64File || null;

  try {
    if (b64Xml) {
      const xmlBytes = Uint8Array.from(atob(b64Xml), (c) => c.charCodeAt(0));
      out.xml_content = new TextDecoder("utf-8").decode(xmlBytes);
    }
  } catch (e) {
    console.error("[fiscal-persist-files] xml decode", e);
  }

  try {
    if (b64File && chave) {
      const fileBytes = Uint8Array.from(atob(b64File), (c) => c.charCodeAt(0));
      const isPdf =
        fileBytes[0] === 0x25 && fileBytes[1] === 0x50 &&
        fileBytes[2] === 0x44 && fileBytes[3] === 0x46;
      const ext = isPdf ? "pdf" : "html";
      const ctype = isPdf ? "application/pdf" : "text/html; charset=utf-8";
      const path = `danfe/${chave}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("fiscal-documents")
        .upload(path, fileBytes, { contentType: ctype, upsert: true });
      if (upErr) {
        console.error("[fiscal-persist-files] upload", upErr);
      } else if (isPdf) {
        const { data: signed } = await supabase.storage
          .from("fiscal-documents")
          .createSignedUrl(path, 315360000);
        if (signed?.signedUrl) out.danfe_url = signed.signedUrl;
      } else {
        const { data: pub } = supabase.storage.from("fiscal-documents").getPublicUrl(path);
        const rendered = buildRenderableDanfeUrl(pub?.publicUrl || null);
        if (rendered) out.danfe_url = rendered;
      }
    }
  } catch (e) {
    console.error("[fiscal-persist-files] file decode/upload", e);
  }

  return out;
}
