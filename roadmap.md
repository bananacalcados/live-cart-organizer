# Rodada de ajustes — modo WhatsApp + Cadastro online

Regras: NÃO alterar modos manual/member_area/whatsapp nem eventos existentes. NÃO publicar o site.

- [x] BLOCO 0 — Auditoria (respondida em texto antes de codar)
- [x] BLOCO 1 — Chat interno fora das páginas públicas (/pedido, /ao-vivo) — TeamChat oculto
- [x] BLOCO 2 — Fila persistida anti-spam (4s por instância, retry 30s/2min/10min/30min, 5 tentativas, idempotência por chave, fallback para envio direto, alerta + reenvio na Central da Live). Só no modo whatsapp_autoatendimento; modos antigos seguem envio direto.
- [x] BLOCO 3 — Sorteio ao vivo: contador/lista de elegíveis em tempo real no painel, sorteio grava evento `raffle_draw`, overlay gira a roleta com confete, destaque 10s e barra "Ganhadora: @x", botão "Testar sorteio" no controle do overlay
- [x] BLOCO 4 — Faixa de confiança no link do carrinho (10 anos/2 lojas, selo Google configurável no evento, Mercado Pago + bandeiras)
- [x] BLOCO 5 — Interruptor "match avançado Meta" na Etapa 1 do assistente (padrão ligado)
- [ ] BLOCO 6 — Vídeos tutoriais (subagente sub_1tsr7cmg em andamento) + botões "Como funciona?"/"Como pagar?" nas páginas — aguardando os arquivos de vídeo

Verificação: 24 testes passando, build OK, fila testada no banco (idempotência, ordem, intervalo), funções publicadas no backend. Site NÃO publicado.
