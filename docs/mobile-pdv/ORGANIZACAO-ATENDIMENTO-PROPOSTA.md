# Proposta de organização do atendimento

**Somente levantamento para o Matthews decidir. Nenhuma organização nova foi ativada.**
Corte: 28/11/2026 às 14:17:30 de Brasília (17:17:30 UTC). Sem nomes, telefones ou mensagens de clientes neste documento.

## Sinais que já existem

| Sinal | O que já conseguimos saber | Cuidado |
|---|---|---|
| Linha/fila | Novas, Não lidas, Follow Up, Pedidos da Live, Suporte, Grupos e Finalizadas; marcação manual por conversa/instância | Linha Não lidas e bolinha de mensagens não lidas não são a mesma coisa |
| Instância | Número/conta e loja vinculada | A mesma cliente em duas instâncias são dois atendimentos; não misturar |
| Vendedor | Responsável, nome e identidade; primeira resposta atribui quando ainda não há dono | Troca de responsável deve ser explícita |
| Não lidas | Quantas recebidas ainda não foram lidas | Marcar como lida não responde à cliente |
| Última mensagem sem resposta | Horário da última recebida, última enviada e direção; permite medir espera | Automático pode parecer nossa resposta |
| Pedido da live | Evento, pedido, etapa e pago/não pago; computador destaca o não pago mais recente | Telefone incompleto não identifica com segurança; vínculo atual não prova a origem histórica |
| Carrinho/pagamento pendente | Marcador de aguardando pagamento, venda/pedido associado, lembretes ativos | Lembrete não comprova validade da cobrança ou pagamento; nada de pagamento foi alterado |
| Automática x cliente | Direção recebida/enviada, origem, marca de disparo e identidade de remetente | Muitos envios têm origem genérica e não têm identificação humana; não usar IA para adivinhar |
| Conversa nova x cliente antigo | Histórico, encerramentos, cadastro e quantidade de compras | Nunca conversou, nunca comprou e voltou depois de encerrada são coisas diferentes |

## O que o computador oferece hoje

- Escolha de vendedor por loja/sessão, troca e etiqueta de responsável; atribuição e transferência.
- Busca por nome/telefone e separação de instância; visual Tradicional ou em Linhas.
- Linhas de atendimento, suporte, grupos, finalizadas e mudanças manuais.
- Filtro da live, etapa e painel do pedido; entre vários pedidos, privilegia o não pago mais recente.
- Não lidas, aguardando resposta/pagamento, arquivadas e disparos; tarefas e chat da equipe.
- Histórico gradual e atualização por eventos.

Isso não garante uma prioridade própria para clientes sem pedido da live, nem que leitura seja confundida com resposta.

## Critérios dos números reais

- Ativa = cliente escreveu ao menos uma vez naquela hora, contada uma vez por telefone e instância. A mesma conversa pode contar em várias horas.
- Live = telefone completo vinculado a pedido daquele evento, por DDD + últimos oito dígitos. **Sem vínculo** = sem pedido desse evento identificado; interessadas sem pedido podem estar aí. Não é prova de que estavam fora da live.
- Só WhatsApp individual. Grupos, Instagram/comentários, disparos em massa, mensagens recebidas apagadas e envios falhos ficam fora.
- Referência temporal: primeiro/último comentário armazenado, não horário oficial da transmissão. Janelas de Brasília: 25/11 11:59–23:55; 27/11 12:08–18:28; 28/11 11:58–14:17 (parcial). O armazenamento pode continuar depois da live.
- Cada mensagem recebida foi comparada com o próximo envio na mesma conversa. Nos dias concluídos, observei respostas por até uma hora além do fim da janela; hoje, somente até o corte real.
- Uma conversa conta em >10/30/60 min se pelo menos uma mensagem ficou esperando esse tempo. Colunas acumulativas, não o estoque de pendências de agora. Tempo futuro nunca conta.
- Qualquer envio registrado pode incluir automático e não comprova leitura pela cliente. A segunda tabela mede só envio com identidade de usuário, mas pode superestimar espera humana quando a equipe usou um caminho antigo sem identificação.

## Espera sem qualquer envio registrado

| Live | Instância | Vínculo | Ativas no período | >10 min | >30 min | >60 min |
|---|---|---|---:|---:|---:|---:|
| 25/11 | Meta Centro | Sem vínculo | 6 | 6 | 6 | 6 |
| 25/11 | Meta Centro | Live | 1 | 1 | 1 | 1 |
| 25/11 | Meta Pérola | Sem vínculo | 58 | 44 | 43 | 40 |
| 25/11 | Meta Pérola | Live | 42 | 37 | 33 | 33 |
| 25/11 | Ravena | Sem vínculo | 2 | 2 | 2 | 2 |
| 25/11 | Whats Carol | Sem vínculo | 22 | 20 | 19 | 18 |
| 25/11 | Whats Centro | Sem vínculo | 28 | 25 | 23 | 19 |
| 25/11 | Whats Centro | Live | 2 | 1 | 1 | 1 |
| 25/11 | Whats Pérola | Sem vínculo | 150 | 93 | 88 | 85 |
| 25/11 | Whats Pérola | Live | 97 | 35 | 28 | 23 |
| 27/11 | Meta Centro | Sem vínculo | 3 | 3 | 3 | 3 |
| 27/11 | Meta Pérola | Sem vínculo | 30 | 22 | 21 | 21 |
| 27/11 | Meta Pérola | Live | 21 | 19 | 19 | 18 |
| 27/11 | Ravena | Sem vínculo | 5 | 5 | 5 | 5 |
| 27/11 | Whats Carol | Sem vínculo | 24 | 21 | 20 | 17 |
| 27/11 | Whats Pérola | Sem vínculo | 105 | 85 | 80 | 74 |
| 27/11 | Whats Pérola | Live | 52 | 17 | 12 | 11 |
| 28/11 parcial | Meta Centro | Sem vínculo | 3 | 3 | 2 | 2 |
| 28/11 parcial | Meta Pérola | Sem vínculo | 181 | 166 | 156 | 137 |
| 28/11 parcial | Meta Pérola | Live | 17 | 11 | 6 | 3 |
| 28/11 parcial | Whats Carol | Sem vínculo | 12 | 11 | 9 | 6 |
| 28/11 parcial | Whats Pérola | Sem vínculo | 106 | 41 | 32 | 21 |
| 28/11 parcial | Whats Pérola | Live | 43 | 3 | 2 | 0 |

## Espera por envio com identidade de usuário registrada

Não usar essa contagem como avaliação individual de vendedor. A diferença entre as tabelas mostra por que não conseguimos provar a espera exata por resposta humana em todos os caminhos antigos.

| Live | Instância | Vínculo | >10 min | >30 min | >60 min |
|---|---|---|---:|---:|---:|
| 25/11 | Meta Centro | Sem vínculo | 6 | 6 | 6 |
| 25/11 | Meta Centro | Live | 1 | 1 | 1 |
| 25/11 | Meta Pérola | Sem vínculo | 58 | 58 | 55 |
| 25/11 | Meta Pérola | Live | 40 | 36 | 36 |
| 25/11 | Ravena | Sem vínculo | 2 | 2 | 2 |
| 25/11 | Whats Carol | Sem vínculo | 22 | 22 | 22 |
| 25/11 | Whats Centro | Sem vínculo | 25 | 23 | 19 |
| 25/11 | Whats Centro | Live | 1 | 1 | 1 |
| 25/11 | Whats Pérola | Sem vínculo | 145 | 141 | 138 |
| 25/11 | Whats Pérola | Live | 81 | 69 | 63 |
| 27/11 | Meta Centro | Sem vínculo | 3 | 3 | 3 |
| 27/11 | Meta Pérola | Sem vínculo | 30 | 29 | 29 |
| 27/11 | Meta Pérola | Live | 20 | 20 | 20 |
| 27/11 | Ravena | Sem vínculo | 5 | 5 | 5 |
| 27/11 | Whats Carol | Sem vínculo | 24 | 24 | 24 |
| 27/11 | Whats Pérola | Sem vínculo | 100 | 95 | 89 |
| 27/11 | Whats Pérola | Live | 41 | 32 | 30 |
| 28/11 parcial | Meta Centro | Sem vínculo | 3 | 2 | 2 |
| 28/11 parcial | Meta Pérola | Sem vínculo | 176 | 164 | 144 |
| 28/11 parcial | Meta Pérola | Live | 13 | 7 | 5 |
| 28/11 parcial | Whats Carol | Sem vínculo | 12 | 12 | 9 |
| 28/11 parcial | Whats Pérola | Sem vínculo | 93 | 76 | 55 |
| 28/11 parcial | Whats Pérola | Live | 30 | 16 | 7 |

## Ativas por hora por instância

Brasília. Hora inicial/final pode estar incompleta. Horas sem recebidas foram omitidas. Total = Live + Sem vínculo naquela hora, não pessoas únicas do evento inteiro.

| Live | Hora | Instância | Live | Sem vínculo | Total |
|---|---|---|---:|---:|---:|
| 25/11 | 11:00 | Whats Pérola | 0 | 3 | 3 |
| 25/11 | 12:00 | Meta Centro | 0 | 2 | 2 |
| 25/11 | 12:00 | Meta Pérola | 1 | 7 | 8 |
| 25/11 | 12:00 | Whats Carol | 0 | 4 | 4 |
| 25/11 | 12:00 | Whats Centro | 0 | 6 | 6 |
| 25/11 | 12:00 | Whats Pérola | 2 | 17 | 19 |
| 25/11 | 13:00 | Meta Centro | 0 | 2 | 2 |
| 25/11 | 13:00 | Meta Pérola | 2 | 13 | 15 |
| 25/11 | 13:00 | Whats Carol | 0 | 7 | 7 |
| 25/11 | 13:00 | Whats Centro | 0 | 5 | 5 |
| 25/11 | 13:00 | Whats Pérola | 13 | 33 | 46 |
| 25/11 | 14:00 | Meta Centro | 0 | 1 | 1 |
| 25/11 | 14:00 | Meta Pérola | 9 | 10 | 19 |
| 25/11 | 14:00 | Whats Carol | 0 | 4 | 4 |
| 25/11 | 14:00 | Whats Centro | 0 | 7 | 7 |
| 25/11 | 14:00 | Whats Pérola | 19 | 31 | 50 |
| 25/11 | 15:00 | Meta Centro | 1 | 3 | 4 |
| 25/11 | 15:00 | Meta Pérola | 9 | 11 | 20 |
| 25/11 | 15:00 | Ravena | 0 | 1 | 1 |
| 25/11 | 15:00 | Whats Carol | 0 | 2 | 2 |
| 25/11 | 15:00 | Whats Centro | 0 | 6 | 6 |
| 25/11 | 15:00 | Whats Pérola | 33 | 24 | 57 |
| 25/11 | 16:00 | Meta Centro | 1 | 2 | 3 |
| 25/11 | 16:00 | Meta Pérola | 8 | 9 | 17 |
| 25/11 | 16:00 | Whats Carol | 0 | 3 | 3 |
| 25/11 | 16:00 | Whats Centro | 1 | 5 | 6 |
| 25/11 | 16:00 | Whats Pérola | 28 | 28 | 56 |
| 25/11 | 17:00 | Meta Centro | 1 | 0 | 1 |
| 25/11 | 17:00 | Meta Pérola | 12 | 7 | 19 |
| 25/11 | 17:00 | Whats Carol | 0 | 1 | 1 |
| 25/11 | 17:00 | Whats Centro | 2 | 6 | 8 |
| 25/11 | 17:00 | Whats Pérola | 33 | 23 | 56 |
| 25/11 | 18:00 | Meta Pérola | 9 | 11 | 20 |
| 25/11 | 18:00 | Ravena | 0 | 1 | 1 |
| 25/11 | 18:00 | Whats Carol | 0 | 2 | 2 |
| 25/11 | 18:00 | Whats Pérola | 21 | 19 | 40 |
| 25/11 | 19:00 | Meta Pérola | 3 | 5 | 8 |
| 25/11 | 19:00 | Whats Carol | 0 | 4 | 4 |
| 25/11 | 19:00 | Whats Centro | 0 | 2 | 2 |
| 25/11 | 19:00 | Whats Pérola | 3 | 10 | 13 |
| 25/11 | 20:00 | Meta Pérola | 1 | 6 | 7 |
| 25/11 | 20:00 | Whats Centro | 0 | 3 | 3 |
| 25/11 | 20:00 | Whats Pérola | 1 | 5 | 6 |
| 25/11 | 21:00 | Meta Pérola | 1 | 4 | 5 |
| 25/11 | 21:00 | Whats Carol | 0 | 3 | 3 |
| 25/11 | 21:00 | Whats Centro | 0 | 1 | 1 |
| 25/11 | 21:00 | Whats Pérola | 0 | 5 | 5 |
| 25/11 | 22:00 | Whats Carol | 0 | 1 | 1 |
| 25/11 | 23:00 | Meta Pérola | 1 | 0 | 1 |
| 27/11 | 12:00 | Meta Centro | 0 | 1 | 1 |
| 27/11 | 12:00 | Meta Pérola | 4 | 4 | 8 |
| 27/11 | 12:00 | Whats Carol | 0 | 3 | 3 |
| 27/11 | 12:00 | Whats Pérola | 17 | 23 | 40 |
| 27/11 | 13:00 | Meta Centro | 0 | 2 | 2 |
| 27/11 | 13:00 | Meta Pérola | 5 | 6 | 11 |
| 27/11 | 13:00 | Whats Carol | 0 | 5 | 5 |
| 27/11 | 13:00 | Whats Pérola | 12 | 28 | 40 |
| 27/11 | 14:00 | Meta Pérola | 3 | 5 | 8 |
| 27/11 | 14:00 | Ravena | 0 | 2 | 2 |
| 27/11 | 14:00 | Whats Carol | 0 | 10 | 10 |
| 27/11 | 14:00 | Whats Pérola | 7 | 15 | 22 |
| 27/11 | 15:00 | Meta Centro | 0 | 1 | 1 |
| 27/11 | 15:00 | Meta Pérola | 5 | 4 | 9 |
| 27/11 | 15:00 | Ravena | 0 | 1 | 1 |
| 27/11 | 15:00 | Whats Carol | 0 | 6 | 6 |
| 27/11 | 15:00 | Whats Pérola | 19 | 22 | 41 |
| 27/11 | 16:00 | Meta Pérola | 6 | 8 | 14 |
| 27/11 | 16:00 | Ravena | 0 | 2 | 2 |
| 27/11 | 16:00 | Whats Carol | 0 | 5 | 5 |
| 27/11 | 16:00 | Whats Pérola | 11 | 23 | 34 |
| 27/11 | 17:00 | Meta Centro | 0 | 1 | 1 |
| 27/11 | 17:00 | Meta Pérola | 3 | 4 | 7 |
| 27/11 | 17:00 | Whats Carol | 0 | 10 | 10 |
| 27/11 | 17:00 | Whats Pérola | 11 | 27 | 38 |
| 27/11 | 18:00 | Meta Centro | 0 | 1 | 1 |
| 27/11 | 18:00 | Meta Pérola | 1 | 5 | 6 |
| 27/11 | 18:00 | Whats Carol | 0 | 1 | 1 |
| 27/11 | 18:00 | Whats Pérola | 2 | 10 | 12 |
| 28/11 parcial | 12:00 | Meta Centro | 0 | 1 | 1 |
| 28/11 parcial | 12:00 | Meta Pérola | 5 | 133 | 138 |
| 28/11 parcial | 12:00 | Whats Carol | 0 | 6 | 6 |
| 28/11 parcial | 12:00 | Whats Pérola | 18 | 63 | 81 |
| 28/11 parcial | 13:00 | Meta Centro | 0 | 3 | 3 |
| 28/11 parcial | 13:00 | Meta Pérola | 9 | 45 | 54 |
| 28/11 parcial | 13:00 | Whats Carol | 0 | 7 | 7 |
| 28/11 parcial | 13:00 | Whats Pérola | 30 | 47 | 77 |
| 28/11 parcial | 14:00 | Meta Pérola | 8 | 12 | 20 |
| 28/11 parcial | 14:00 | Whats Carol | 0 | 1 | 1 |
| 28/11 parcial | 14:00 | Whats Pérola | 15 | 14 | 29 |

## Leitura dos números

Na Whats Pérola em 27/11, das 105 conversas sem vínculo identificado, 85 tiveram espera acima de 10 minutos e 74 acima de uma hora sem qualquer envio registrado. Entre as 52 vinculadas, foram 17 e 11. Isso justifica atenção própria às sem pedido identificado, sem afirmar a causa individual.

A live de hoje é parcial. Whats Carol aparece porque clientes responderam nesse número; continua sendo instância de disparos, não indicação para iniciar atendimento.

## Proposta para decidir — não implementada

1. Dois grupos de visualização: Atendimento da loja e Pedidos da live, sem mudar instância de envio nem duplicar conversas. Interessada sem pedido fica no atendimento até identificação segura.
2. Ordenar pela mensagem da cliente há mais tempo sem resposta humana, mesmo se já lida. A bolinha de não lidas continua separada.
3. Vendedor visível, Minhas e Sem vendedor; transferência explícita, sem roubar atendimento de outra pessoa.
4. Destaques de 10/30/60 minutos por eventos e botão Atualizar, sem consultas periódicas novas.
5. Dar destaque ao atendimento sem pedido da live que passou do limite, sem mudar ritmo anti-ban, filas automáticas ou cobrança.

### O que o Matthews precisa decidir

- Interessada que comentou na live mas não tem pedido identificado fica em Atendimento da loja ou em um terceiro grupo?
- A espera que chama atenção primeiro é 10 ou 30 minutos?
- Minhas deve incluir Sem vendedor disponíveis ou apenas as já atribuídas?
- Automático nunca tira a cliente da espera humana? Sugestão: nunca tirar.

## Limites e fontes

Somente leitura em produção; nenhuma mensagem de teste ou mudança de regra. A consulta foi limitada a três janelas, usando índices existentes de mensagens por data sem disparo, pedidos por evento e cliente por identificador. Sem baixar tabelas inteiras, sem índice/cron novo.

Fontes técnicas: whatsapp_messages/whatsapp_conversations, orders + customers, chat_conversation_lanes, chat_conversation_assignments, chat_awaiting_payment, chat_payment_followups, customers_unified e o visual atual de POSWhatsApp. Estes nomes são só para rastrear o levantamento.

O telefone do pedido pode ter sido corrigido depois da live. Não há fotografia histórica perfeita da identidade/atribuição; não usei finais de quatro dígitos nem IA para inventar vínculo. Não é possível provar atendimento humano fora do registro, entrega/leitura no telefone pessoal, nem separar todo envio automático antigo que ficou com origem genérica.
