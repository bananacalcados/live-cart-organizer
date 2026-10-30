# Auditoria (só leitura) — templates Meta: UTILITY + imagem + 2 ou mais variáveis

Consulta feita na Meta em 30/10/2026, às 17:40 UTC, com o token de cada número. Nada foi alterado. A nota de qualidade veio "UNKNOWN" em todos.

## Pérola e Centro: são contas diferentes
- Meta Pérola (ae453235): conta 1297001419017577, 94 modelos
- Meta Centro (c01d2777): conta 1240368761111264, 70 modelos
- As listas são diferentes e nenhum par de números tem modelos iguais. Os outros 4 números Meta (Zoppy, Banana Calçados, Datacrazy, Ravena) também têm cada um a sua conta.

## Os 6 modelos pedidos
| Modelo | Pérola | Centro |
|---|---|---|
| aviso_3 | APROVADO, UTILITY (antes era MARKETING), 3 variáveis | não existe |
| aviso_conv | APROVADO, UTILITY (antes era MARKETING), 2 variáveis | não existe |
| gru_lemb | APROVADO, UTILITY (antes era MARKETING), 3 variáveis | não existe |
| liv_lembr3 | APROVADO, UTILITY, 3 variáveis | **APROVADO, mas a Meta passou para MARKETING (era UTILITY)** |
| lanc_26 | não existe | APROVADO, UTILITY (antes era MARKETING), 3 variáveis |
| livefechames | APROVADO, **MARKETING** (já foi criado assim), não entra no critério | não existe |

## Todos os modelos que atendem aos critérios
| Número | Modelo | Variáveis | Botões | Texto |
|---|---|---|---|---|
| Pérola | aviso_3 | 3 | — | *Aviso*: Oii {{1}} estou passando para te avisar {{2}} / *Só clicar:* {{3}} / Se quiser ajuda ou tiver dúvidas me fala 😊 |
| Pérola | aviso_conv | 2 | — | Oii {{1}} / *Para acompanhar é só clicar:* {{2}} / Qualquer dúvida é só chamar ta bom?😊 |
| Pérola | gru_lemb | 3 | — | *LEMBRETE:* Oii {{1}} estou passando para te avisar {{2}} / {{3}} / Se quiser ajuda ou tiver dúvidas me fala 😊 |
| Pérola | liv_lembr3 | 3 | — | *CONFIRMAÇÃO:* Seu pedido foi confirmado {{1}}. Estamos enviando {{2}} / {{3}} / Tenho certeza que irá gostar... |
| Pérola | arq_3 | 2 | — | Oii {{1}} aqui está o {{2}}. / Posso enviar? |
| Pérola | lemb_liv2 | 3 | — | Sua presença no evento {{1}} de {{2}} está confirmada. / {{3}} / Obrigado. |
| Centro | grup_conv5 | 4 | — | *Você tem um Evento Próximo* / Oii {{1}} to passando pra te lembrar {{2}} / Online: {{3}} / ou / Físico: {{4}}... |
| Centro | liv_lemb4 | 3 | — | *CONFIRMAÇÃO:* Seu pedido foi confirmado {{1}}. Estamos enviando {{2}} / {{3}} / ... |
| Centro | lanc_26 | 3 | — | *Aviso:* Oii {{1}} estou passando pra te falar sobre {{2}} / {{3}} / Qualquer coisa é só chamar😃 |
| Centro | aviso_1 | 3 | — | *Aviso:* Oii {{1}} estou passando pra te falar {{2}} chegou. / {{3}} / ... |
| Banana Calçados | lemb_liv2 | 3 | — | igual ao da Pérola |
| Banana Calçados | lanc2_2026 | 3 | CONFIRMAR / NÃO CONFIRMAR | *CONFIRMADO:* Oii {{1}} to passando pra te falar {{2}}. / {{3}} / Confirme abaixo por favor👇 |
| Banana Calçados | lanc_2026 | 3 | Confirmar / Não confirmar | *Lembrete:* Oii {{1}} to passando pra te falar {{2}}. / {{3}} / Confirme abaixo... |
| Banana Calçados | lan_ | 3 | Confirmar / Não confirmar | *ATENÇÃO*: Fica atento {{1}} que já ta quase chegando {{2}}. / {{3}} / ... |
| Datacrazy | lan_ | 3 | Confirmar / Não confirmar | igual ao do Banana Calçados |
| Ravena | lemb_liv2 | 3 | — | igual ao da Pérola |
| Ravena | namo_rav | 3 | — | Oláá {{1}} estou enviando {{2}} / {{3}} / Tenho certeza que irá gostar 😁 |
| Ravena | aviso_01 | 3 | — | Oii {{1}} estamos enviando {{2}} / {{3}} / Tenho certeza que irá gostar! |

## O que a Meta mudou
- **Passou de UTILITY para MARKETING:** só o **liv_lembr3 do Centro**. No Centro esse modelo tem outro texto ("*LEMBRETE:* ... Já estamos te aguardando na {{2}}"), por isso não entra mais na lista.
- No número Zoppy, vários modelos antigos também foram para MARKETING, mas nenhum deles tem imagem e 2 variáveis ao mesmo tempo.
- Os que estão marcados "antes era MARKETING" hoje estão como UTILITY.

Não há nada para implementar. É só leitura.
