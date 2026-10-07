# Ligar conversa do Instagram ao cliente que já comprou na live

## O que já existe (conferido)
- Pedidos da live guardam o @ do Instagram do cliente: 3.581 clientes com @, 3.393 deles com WhatsApp.
- Exemplo: @deliafritzen já é cliente, com WhatsApp 5551997553956, mas o chat mostra só o número interno do Instagram (1615215293717208), "CPF/Endereço não informado" e "Nenhum pedido pago".
- A conversa do Instagram já traz o @ da pessoa (nome do remetente "@deliafritzen").
- A busca por @ no cadastro já é rápida (há índices prontos para isso). A ficha geral de clientes também guarda @ e o ID do Instagram.

## Riscos analisados
1. **Lentidão:** buscar o cliente por @ em todas as conversas da lista deixaria a tela pesada. Por isso a busca só acontece **quando a conversa é aberta**: 1 consulta rápida por índice, guardada em memória para não repetir. A lista não muda e não ganha consultas.
2. **Cliente errado:** a pessoa pode trocar de @, ou o @ pode estar anotado diferente ("@Delia.Fritzen", "deliafritzen "). Vamos comparar só o @ exato depois de padronizar (minúsculo, sem "@" e sem espaços). Não vamos usar parecidos nem IA. Se aparecer mais de um cliente, nada é ligado sozinho: a tela avisa e a vendedora escolhe.
3. **Troca de @ no futuro:** na primeira vez que a ligação for confirmada, guardamos o ID fixo do Instagram da pessoa. Daí em diante a ligação vale por esse ID, mesmo que ela mude o @.
4. **Quebrar o envio:** a conversa continua sendo do Instagram e a resposta continua saindo pelo Instagram. O WhatsApp encontrado é só para consulta, com um botão opcional "Abrir no WhatsApp". O envio não muda em nada.
5. **Dados manuais:** a ligação nunca mexe no cadastro do cliente (telefone, nome, @). Ela só guarda o vínculo à parte.
6. **Realtime e histórico:** a forma como as mensagens chegam e o histórico antigo não são alterados.

## O que a vendedora vai ver
No painel da direita, numa conversa do Instagram de quem já é cliente:
- Selo "Cliente da live" com o nome e o WhatsApp encontrado, e o botão "Abrir conversa no WhatsApp".
- CPF, endereço e "Pedidos pagos" puxados pelo telefone do cadastro, iguais aos de uma conversa de WhatsApp.
- Um botão "Não é essa pessoa" para desfazer uma ligação errada. Desfeita, ela não volta sozinha.
- Quando ninguém é encontrado, tudo fica como é hoje.

## Etapas (cada uma pode ser testada e desfeita sozinha)
1. **Banco:** uma função que recebe o @ e/ou o ID do Instagram e devolve no máximo 5 clientes possíveis (nome, WhatsApp, CPF), buscando primeiro pelo vínculo salvo, depois pelo ID e por último pelo @ exato. Também uma tabelinha para guardar o vínculo confirmado ou recusado.
2. **Painel do chat do PDV:** ao abrir uma conversa do Instagram, chama essa função uma vez e, se achar o cliente, monta o painel usando o telefone dele, pelo mesmo caminho que já existe para o WhatsApp.
3. **Painel do WhatsApp da Live:** mesmo comportamento, usando o mesmo componente.

## Custo para o sistema
- Ao abrir uma conversa do Instagram: +1 consulta rápida, mais as consultas que o painel já faz hoje, agora feitas pelo telefone encontrado.
- Nada repete sozinho e não há consultas a cada X segundos. A lista de conversas não muda.

## Testes previstos
- Abrir a conversa de @deliafritzen e conferir se aparecem o WhatsApp 5551997553956 e os pedidos dela.
- Abrir uma conversa do Instagram de quem não é cliente: tudo continua igual.
- Clicar em "Não é essa pessoa" e conferir que a ligação não volta.
- Responder pelo Instagram depois disso, para confirmar que a mensagem sai pelo Instagram.
- Medir quanto tempo a consulta leva.

## Detalhes técnicos
- Tabela `instagram_customer_links` (ig_user_id, username_norm, customer_id, unified_id, status confirmed/rejected, created_by). Com GRANT para authenticated/service_role e RLS para a equipe.
- RPC `resolve_instagram_customer(p_username, p_ig_user_id)`: busca nos índices que já existem (`ig_handle_norm` em customers, `lower(instagram_handle)` em customers_unified), com LIMIT 5. O plano da consulta será conferido antes de entregar.
- Sem gatilhos novos em tabelas grandes e sem processamento em massa.
