export type EmailBlockType =
  | 'header'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'footer';

export interface HeaderBlockProps {
  logoUrl: string;
  logoAlt: string;
  backgroundColor: string;
  logoWidth: number;
  alignment: 'left' | 'center' | 'right';
}

export interface TextBlockProps {
  content: string;
  fontSize: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  backgroundColor: string;
  paddingY: number;
  paddingX: number;
}

export interface ImageBlockProps {
  src: string;
  alt: string;
  linkUrl: string;
  width: string;
  alignment: 'left' | 'center' | 'right';
}

export interface ButtonBlockProps {
  text: string;
  url: string;
  backgroundColor: string;
  textColor: string;
  alignment: 'left' | 'center' | 'right';
  borderRadius: number;
  paddingX: number;
  paddingY: number;
  fontSize: number;
}

export interface DividerBlockProps {
  color: string;
  thickness: number;
  width: string;
  style: 'solid' | 'dashed' | 'dotted';
}

export interface SpacerBlockProps {
  height: number;
}

export interface FooterBlockProps {
  content: string;
  color: string;
  fontSize: number;
  backgroundColor: string;
  showUnsubscribe: boolean;
  unsubscribeText: string;
}

export type EmailBlockProps =
  | HeaderBlockProps
  | TextBlockProps
  | ImageBlockProps
  | ButtonBlockProps
  | DividerBlockProps
  | SpacerBlockProps
  | FooterBlockProps;

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  props: EmailBlockProps;
}

export const DEFAULT_BLOCK_PROPS: Record<EmailBlockType, EmailBlockProps> = {
  header: {
    logoUrl: '',
    logoAlt: 'Logo',
    backgroundColor: '#ffffff',
    logoWidth: 150,
    alignment: 'center',
  } as HeaderBlockProps,
  text: {
    content: '<p>Digite seu texto aqui...</p>',
    fontSize: 16,
    color: '#333333',
    alignment: 'left',
    backgroundColor: 'transparent',
    paddingY: 10,
    paddingX: 20,
  } as TextBlockProps,
  image: {
    src: '',
    alt: 'Imagem',
    linkUrl: '',
    width: '100%',
    alignment: 'center',
  } as ImageBlockProps,
  button: {
    text: 'Clique aqui',
    url: 'https://',
    backgroundColor: '#e8a000',
    textColor: '#ffffff',
    alignment: 'center',
    borderRadius: 6,
    paddingX: 32,
    paddingY: 14,
    fontSize: 16,
  } as ButtonBlockProps,
  divider: {
    color: '#e0e0e0',
    thickness: 1,
    width: '100%',
    style: 'solid',
  } as DividerBlockProps,
  spacer: {
    height: 20,
  } as SpacerBlockProps,
  footer: {
    content: '© 2025 Sua Empresa. Todos os direitos reservados.',
    color: '#999999',
    fontSize: 12,
    backgroundColor: '#f5f5f5',
    showUnsubscribe: true,
    unsubscribeText: 'Descadastrar',
  } as FooterBlockProps,
};

export const BLOCK_LABELS: Record<EmailBlockType, { label: string; description: string }> = {
  header: { label: 'Cabeçalho', description: 'Logo e fundo' },
  text: { label: 'Texto', description: 'Texto rico formatado' },
  image: { label: 'Imagem', description: 'Imagem com link' },
  button: { label: 'Botão', description: 'CTA com link' },
  divider: { label: 'Divisor', description: 'Linha separadora' },
  spacer: { label: 'Espaço', description: 'Espaço em branco' },
  footer: { label: 'Rodapé', description: 'Rodapé + descadastro' },
};

export const PERSONALIZATION_VARS = [
  { key: '{{nome}}', label: 'Nome' },
  { key: '{{email}}', label: 'Email' },
  { key: '{{empresa}}', label: 'Empresa' },
];
