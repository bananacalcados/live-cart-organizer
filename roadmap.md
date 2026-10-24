# Rodada de ajustes — modo WhatsApp + Cadastro online

## Ajustes de fila — 24/10
- [ ] Intervalo aleatório persistido de 3–7 segundos por instância e testes.
- [ ] Recuperação por minuto enquanto há trabalho, liberando reservas após 2 minutos.
- [ ] Conferir status/reenvio pela mesma chave e entregar arquivos alterados, sem publicar.

Regras: NÃO alterar modos manual/member_area/whatsapp nem eventos existentes. NÃO publicar o site.

- [x] BLOCO 0 — Auditoria (respondida em texto antes de codar)
- [x] BLOCO 1 — Chat interno fora das páginas públicas (/pedido, /ao-vivo) — TeamChat oculto
- [x] BLOCO 2 — Fila persistida anti-spam (4s por instância, retry 30s/2min/10min/30min, 5 tentativas, idempotência por chave, fallback para envio direto, alerta + reenvio na Central da Live). Só no modo whatsapp_autoatendimento; modos antigos seguem envio direto.
- [x] BLOCO 3 — Sorteio ao vivo: contador/lista de elegíveis em tempo real no painel, sorteio grava evento `raffle_draw`, overlay gira a roleta com confete, destaque 10s e barra "Ganhadora: @x", botão "Testar sorteio" no controle do overlay
- [x] BLOCO 4 — Faixa de confiança no link do carrinho (10 anos/2 lojas, selo Google configurável no evento, Mercado Pago + bandeiras)
- [x] BLOCO 5 — Interruptor "match avançado Meta" na Etapa 1 do assistente (padrão ligado)
- [x] BLOCO 6 — Vídeos tutoriais (41s cada, verticais) + botões "Como funciona?"/"Como pagar?" nas páginas

Verificação: 24 testes passando, build OK, fila testada no banco (idempotência, ordem, intervalo, recuperação de travada), funções publicadas no backend. Site NÃO publicado.

Ressalvas dos vídeos (conferir antes de mostrar às clientes): dados de exemplo fictícios (Maria Aparecida Souza, Tênis Ortopédico R$ 189,90), QR Code ilustrativo (não escaneia), painel de parcelas do cartão é desenho (a tela real não carregou com pedido fictício), sem narração (textos + música).
