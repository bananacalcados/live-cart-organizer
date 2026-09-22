# Mensagens Prontas em rodízio + variáveis de preço (anti-spam)

## O que você pediu
1. Criar variações da mesma pergunta e revezar a cada envio (etapas 1, 2 e 3).
2. Mais variáveis, principalmente valor no Pix e valor no cartão/parcelas.
3. Auditoria: se eu usar a variável de nome, ela puxa o primeiro nome da ficha?

## Resultado da auditoria (importante)
Hoje a variável `{{nome}}` **não** puxa o nome da ficha do cliente. Ela usa o @ do
Instagram sem o arroba — ou seja, "juliana_soares_292" vira "juliana_soares_292".
Se o pedido tiver só o @, o texto sai feio.

Correção incluída neste trabalho:
- `{{nome}}` passa a ser o **primeiro nome do campo Nome completo** da ficha, com
  a primeira letra maiúscula.
- Se a ficha ainda não tem nome completo, cai para a primeira palavra do @
  (comportamento de hoje), então nada quebra.
- Novas variáveis: `{{nome_completo}}` e `{{primeiro_nome}}` (apelido de `{{nome}}`).
- `{{instagram}}` continua igual.

## Etapas e rodízio
Cada mensagem pronta ganha um campo **Etapa de atendimento** (Etapa 1 — dados,
Etapa 2 — CPF/e-mail, Etapa 3 — pagamento, ou Nenhuma) e um campo **Variações**:
o mesmo botão guarda várias redações da mesma pergunta.

No chat aparece **um botão por etapa** ("Etapa 1", "Etapa 2", "Etapa 3"). A cada
clique o sistema escolhe a próxima variação em rodízio, por etapa e por instância
de WhatsApp — com 4 variações, cada uma só se repete a cada 4 envios. O rodízio é
gravado no banco (contador atômico), então funciona igual mesmo com várias
vendedoras clicando ao mesmo tempo.

## Novas variáveis de preço (etapa 3)
- `{{total}}` — total do pedido (já existe)
- `{{total_pix}}` — total com 5% de desconto no Pix
- `{{desconto_pix}}` — quanto ela economiza no Pix
- `{{parcelas_max}}` — nº máximo de parcelas sem juros daquele pedido/live
- `{{valor_parcela}}` — valor de cada parcela
- `{{parcelamento}}` — frase pronta, ex.: "até 10x de R$ 35,99 sem juros"
- `{{produtos}}` / `{{produtos_curto}}` — lista dos produtos

Tudo calculado com a regra de parcelamento do próprio evento/link (a mesma da
área de membros), então a frase nunca promete parcela que o checkout não oferece.

## Outras proteções anti-spam (incluídas)
- **Variação de emoji** já existe (`{{emoji_feliz}}` etc.) e continua ativa.
- **Pequenas variações automáticas**: saudação inicial e pontuação final sorteadas
  entre alternativas equivalentes, para dois envios nunca saírem idênticos.
- **Intervalo humano**: aviso na tela quando a mesma etapa é disparada para
  muitos contatos em poucos minutos, sugerindo espaçar.
- **Nunca mandar link na 1ª mensagem** da etapa 1 (a etapa 1 é só pergunta) —
  já é o seu formato atual, fica registrado como regra.

Recomendações operacionais (sem código): manter a resposta sempre dentro da janela
em que a cliente falou primeiro (é o seu caso, ela chama pelo link), evitar copiar
o mesmo texto entre instâncias diferentes e nunca enviar em lote por essas
instâncias não oficiais.

## Detalhes técnicos
- `message_templates`: novas colunas `funnel_step` (int 0-3) e `variants` (jsonb
  com as redações); a mensagem atual vira a primeira variação no backfill. GRANTs
  e RLS mantidos como hoje.
- Contador de rodízio: tabela `template_step_rotation` (step + whatsapp_number_id)
  com RPC `next_template_variant(p_step, p_number_id, p_count)` (security definer,
  incremento atômico), no mesmo padrão de `next_event_wa_initial_variant`.
- `src/stores/templateStore.ts`: `applyTemplateVariables` ganha as variáveis de
  nome e de preço; helper novo `pickVariant()`.
- `src/components/TemplateManager.tsx`: seletor de etapa, editor de variações
  (adicionar/remover), lista das novas variáveis com prévia.
- `src/components/WhatsAppChat.tsx` e `src/components/chat/QuickReplyPicker.tsx`:
  botões por etapa chamando o rodízio; `getTemplateVariables()` passa a ler
  `customer.full_name` e o cálculo de Pix/parcelas via `installmentRules`.
