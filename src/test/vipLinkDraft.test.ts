import { describe, expect, it } from 'vitest';
import { hasVipLinkWithoutMode } from '@/lib/marketing/vipLinkDraft';

describe('Validação do link de atendimento nos rascunhos VIP', () => {
  it('aceita link na foto quando o texto inicial não tem link', () => {
    expect(hasVipLinkWithoutMode([
      { message_content: 'Separei 3 cores pra você', vip_link_mode: 'none' },
      { message_content: 'Quero essa: {{link_atendimento}}', vip_link_mode: 'product' },
    ])).toBe(false);
  });

  it('bloqueia somente o bloco que usa o placeholder sem configurar o link', () => {
    expect(hasVipLinkWithoutMode([
      { message_content: 'Texto inicial', vip_link_mode: 'none' },
      { message_content: 'Quero essa: {{link_atendimento}}', vip_link_mode: 'none' },
    ])).toBe(true);
  });

  it('aceita link geral no próprio bloco de texto', () => {
    expect(hasVipLinkWithoutMode([
      { message_content: 'Peça aqui: {{link_atendimento}}', vip_link_mode: 'general' },
    ])).toBe(false);
  });
});
