# Vincular pedido da Live ao WhatsApp pelos 4 últimos dígitos

## O que muda para quem trabalha na Live

1. A cliente fala na Live: "quero + produto + cor + **4 últimos dígitos** do WhatsApp".
2. Quem anota cria o pedido normalmente e digita esses 4 dígitos num campo novo do modal do pedido.
3. A cliente clica no link da Live, digita o WhatsApp completo e cai no nosso WhatsApp.
4. O sistema casa sozinho: o telefone digitado termina nos mesmos 4 dígitos de um pedido daquela live → grava o telefone no cadastro da cliente e vincula a conversa ao pedido.
5. A mensagem inicial que ela envia já chega com o @ do Instagram junto, então quem atende identifica na hora e o chat abre com o pedido vinculado.

## Campo novo no modal do pedido

- "4 últimos dígitos do WhatsApp" — aceita só números, exatamente 4.
- Aparece junto de Nome completo / @ do Instagram / WhatsApp.
- Se o WhatsApp completo já estiver preenchido, o campo é preenchido sozinho a partir dele.
- O pedido **sempre pode ser salvo**, mesmo com aviso.

## Avisos de conferência (não bloqueiam o salvamento)

- **Final repetido na mesma live:** se já existe outro pedido ativo nessa live com o mesmo final, aparece um aviso grande em destaque: "Já existe o pedido de @fulana com esse final — a vinculação com o WhatsApp terá que ser feita manualmente". Os dois pedidos ficam marcados como "vinculação manual" e o sistema não casa nenhum dos dois automaticamente.
- **Telefone já usado por outro @:** se o WhatsApp digitado/colado já pertence a outro @ do Instagram, aparece o mesmo tipo de aviso grande, com o @ e o nome de quem já tem esse número, para a pessoa conferir antes de salvar.

## Correção do bug de telefone "grudado"

Hoje o telefone de um pedido reaparece no pedido seguinte de outro @. Correções:

- O formulário é zerado sempre que o modal fecha (hoje só zera em algumas aberturas).
- Ao trocar o @ do Instagram para um @ diferente do que preencheu o telefone, o telefone e o final de 4 dígitos são limpos — só voltam a ser preenchidos se o cadastro daquele @ realmente tiver telefone.
- Preenchimento automático só acontece a partir do cadastro do @ atual; nunca herda o que estava na tela antes.

## Vinculação automática

**Caminho normal (pedido já existe):** quando a cliente confirma o telefone no link da Live, o sistema procura na live corrente um pedido ativo cujo final de 4 dígitos bata e que ainda esteja sem WhatsApp. Achou exatamente um → grava o telefone no cadastro daquela cliente e acrescenta o @ dela ao texto da mensagem inicial. Achou mais de um → não vincula nada e o pedido fica marcado para vinculação manual.

**Caminho retroativo (clicou antes do pedido existir):** ao salvar um pedido com os 4 dígitos, o sistema olha os cliques/mensagens da Live **do mesmo dia e do mesmo evento** e, se houver exatamente um telefone com aquele final, faz a vinculação na hora. Fora desse dia/evento nada é considerado, para nunca puxar contato antigo.

Na fila da Live e no card do pedido, um selo indica "vinculação manual" quando houve empate de final.

## Detalhes técnicos

- Banco: `orders.phone_last4 text` + `orders.link_status` ('auto' | 'manual_required' | 'linked'); índice parcial por `(event_id, phone_last4)` em pedidos não cancelados.
- RPC `live_link_order_by_last4(p_event_id, p_phone_e164)` SECURITY DEFINER: resolve empates, grava telefone no `customers` do pedido, marca `link_status`, devolve `{order_id, instagram_handle, ambiguous}`.
- `live-whatsapp-redirect` (POST, passo 2): após gravar `entered_phone`, chama a RPC pelo `event_id` do link; se vier `instagram_handle`, anexa ` @handle` ao `message_text` antes de montar o `wa.me`.
- Retroativo: no salvamento do pedido (`OrderDialogDb`), RPC `live_backfill_order_phone(p_order_id)` que busca em `live_whatsapp_clicks` do mesmo `event_id` com `created_at::date = current_date` e `right(entered_phone,4) = phone_last4`; exige resultado único.
- Checagens de duplicidade no modal: consulta por `event_id` + `phone_last4` (pedidos ativos) e por telefone normalizado em `customers` com handle diferente; renderizadas como bloco de alerta destacado, sem travar o submit.
- Bug de cache: `resetForm()` no `onOpenChange(false)`, efeito de auto-preenchimento passa a comparar o handle que originou o telefone antes de manter o valor.
