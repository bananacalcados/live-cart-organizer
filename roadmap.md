# Rodada de ajustes — modo WhatsApp + Cadastro online

## Novos contatos — mensagens não lidas
- [x] Priorizar nova mensagem não lida, destacar com tag verde e permitir marcar como lido no card; 8 testes passaram, leitura conferida na live real e consulta indexada validada. Leitura por aparelho (padrão existente); chegada de nova mensagem validada em teste, não com novo envio real. Sem publicar.

## Integridade dos links e vínculos — 24/10
- [x] Investigar e proteger link de pagamento: autoatendimento usa carrinho do pedido exato. Link antigo da Amine mostrou 530 Dourado/35 no navegador; divergência reportada não reproduzida.
- [x] Corrigir vínculo seguro por final único sem conflito; vincular três cadastros confirmados, incluindo Amine, e reprocessar pela fila existente sem reenviar o já enviado.
- [x] Validar carrinho real, fila sent, 15 testes e teste transacional de final único/conflito/empate; site não publicado.

## Carrinho e cadastro — 24/10
- [x] Mostrar frete separado nas páginas públicas do autoatendimento.
- [x] Cadastro confirmado oferece pagamento sem nova confirmação.
- [x] Pedido posterior ao cadastro confirmado recebe link pela fila existente.
- [x] Testar os três caminhos sem publicar o site: 10 testes, identificação transacional com rollback e navegador no pedido real. Sem envio real de WhatsApp.

## Ajustes de fila — 24/10
- [x] Intervalo aleatório persistido de 3–7 segundos por instância e testes.
- [x] Recuperação por minuto enquanto há trabalho, liberando reservas após 2 minutos.
- [x] Conferir status/reenvio pela mesma chave e entregar arquivos alterados, sem publicar.

Verificação da rodada: testes transacionais de pacing/reenvio/recuperação/ativação e remoção do cron passaram; 11 testes do autoatendimento passaram. Fila consultada: pending=0, sending=0, claimed=0, sent=0, failed=0. Cron só existe enquanto há fila. Sem envio real nesta rodada. A chave deduplica a fila, não a aceitação ambígua do provedor.

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
