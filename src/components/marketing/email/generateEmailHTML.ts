import {
  EmailBlock,
  HeaderBlockProps,
  TextBlockProps,
  ImageBlockProps,
  ButtonBlockProps,
  DividerBlockProps,
  SpacerBlockProps,
  FooterBlockProps,
} from './types';

function alignToStyle(align: string) {
  if (align === 'center') return 'margin: 0 auto;';
  if (align === 'right') return 'margin-left: auto; margin-right: 0;';
  return '';
}

function renderHeader(p: HeaderBlockProps): string {
  const align = p.alignment === 'center' ? 'center' : p.alignment === 'right' ? 'right' : 'left';
  const logo = p.logoUrl
    ? `<img src="${p.logoUrl}" alt="${p.logoAlt}" width="${p.logoWidth}" style="display:block;${alignToStyle(p.alignment)}" />`
    : `<span style="font-size:24px;font-weight:bold;color:#333;">${p.logoAlt}</span>`;
  return `<tr><td style="background-color:${p.backgroundColor};padding:20px;text-align:${align};">${logo}</td></tr>`;
}

function renderText(p: TextBlockProps): string {
  return `<tr><td style="padding:${p.paddingY}px ${p.paddingX}px;background-color:${p.backgroundColor};text-align:${p.alignment};font-size:${p.fontSize}px;color:${p.color};font-family:'Inter',Arial,sans-serif;line-height:1.6;">${p.content}</td></tr>`;
}

function renderImage(p: ImageBlockProps): string {
  if (!p.src) return '';
  const img = `<img src="${p.src}" alt="${p.alt}" style="display:block;max-width:100%;width:${p.width};${alignToStyle(p.alignment)}" />`;
  const wrapped = p.linkUrl ? `<a href="${p.linkUrl}" target="_blank">${img}</a>` : img;
  return `<tr><td style="padding:10px 20px;text-align:${p.alignment};">${wrapped}</td></tr>`;
}

function renderButton(p: ButtonBlockProps): string {
  return `<tr><td style="padding:15px 20px;text-align:${p.alignment};">
    <a href="${p.url}" target="_blank" style="display:inline-block;background-color:${p.backgroundColor};color:${p.textColor};font-size:${p.fontSize}px;font-weight:600;text-decoration:none;padding:${p.paddingY}px ${p.paddingX}px;border-radius:${p.borderRadius}px;font-family:'Inter',Arial,sans-serif;">${p.text}</a>
  </td></tr>`;
}

function renderDivider(p: DividerBlockProps): string {
  return `<tr><td style="padding:10px 20px;">
    <hr style="border:none;border-top:${p.thickness}px ${p.style} ${p.color};width:${p.width};margin:0 auto;" />
  </td></tr>`;
}

function renderSpacer(p: SpacerBlockProps): string {
  return `<tr><td style="height:${p.height}px;line-height:${p.height}px;font-size:1px;">&nbsp;</td></tr>`;
}

function renderFooter(p: FooterBlockProps): string {
  const unsub = p.showUnsubscribe
    ? `<br/><a href="{{unsubscribe_url}}" style="color:${p.color};text-decoration:underline;">${p.unsubscribeText}</a>`
    : '';
  return `<tr><td style="background-color:${p.backgroundColor};padding:20px;text-align:center;font-size:${p.fontSize}px;color:${p.color};font-family:'Inter',Arial,sans-serif;line-height:1.5;">${p.content}${unsub}</td></tr>`;
}

const RENDERERS: Record<string, (p: any) => string> = {
  header: renderHeader,
  text: renderText,
  image: renderImage,
  button: renderButton,
  divider: renderDivider,
  spacer: renderSpacer,
  footer: renderFooter,
};

export function generateEmailHTML(blocks: EmailBlock[], subject?: string): string {
  const rows = blocks.map((b) => RENDERERS[b.type]?.(b.props) || '').join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  ${subject ? `<title>${subject}</title>` : ''}
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
    body{margin:0;padding:0;width:100%!important;background-color:#f4f4f4;}
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
${rows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
