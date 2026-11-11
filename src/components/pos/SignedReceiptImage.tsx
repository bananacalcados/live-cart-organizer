import { useSignedReceiptUrl } from "@/lib/storage/signedReceiptUrl";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { url: string | null | undefined };

/** Imagem de comprovante do bucket privado, exibida via link assinado. */
export function SignedReceiptImage({ url, ...rest }: Props) {
  const src = useSignedReceiptUrl(url);
  if (!src) return null;
  return <img src={src} {...rest} />;
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { url: string | null | undefined };

export function SignedReceiptLink({ url, children, ...rest }: LinkProps) {
  const href = useSignedReceiptUrl(url);
  return <a href={href ?? undefined} {...rest}>{children}</a>;
}
