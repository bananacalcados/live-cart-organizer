# Prioridade dos follow-ups v2 — 28/11/2026

## Entrega e implantação

**Preparada e testada, ainda NÃO aplicada ao servidor.** A checagem obrigatória encontrou comentários novos durante o trabalho (10 nos últimos 30 minutos às 15:03 UTC). Implantar agora contrariaria a autorização. Não foi criado agendamento para aplicar depois.

O interruptor continua **v2 com a prioridade anterior**. Nova checagem às 15:07 UTC encontrou **19 comentários recentes**, confirmou que o helper novo não existe em produção e que os interruptores continuam intactos. `product_source_*` continuam `erp`; `pos_mobile_redirect` continua `off`. Nenhuma tela alterada, nenhum site publicado, nenhum envio real de teste. PDV mobile permanece pausado.

## Ordem anterior e nova

Os índices das etapas no banco começam em zero: D0 = 10 min; D1 = 25 min; D2 = 45 min.

| Grupo | Antes | Nova prioridade v2 |
|---|---:|---:|
| D 10 min | 1 | **0 — primeiro** |
| A/B/C e Instagram F inicial | 0 | 1 |
| F após toque: 10 min | 1 | 2 |
| F após toque: 25 min | 2 | 3 |
| F após toque: 45 min | 3 | 4 |
| E cross-sell | 4 | 5 |
| D 25 min | 2 | **6 — só com folga** |
| D 45 min | 3 | **7 — só com folga** |

**A, B e C empatavam e continuam empatados**, não existia preferência A > B > C. Em cada grupo, vence o horário agendado mais antigo; empate exato usa o identificador. A ordem relativa de A/B/C/F/E foi preservada. A prioridade antiga é mantida exclusivamente no v1, permitindo voltar ao comportamento anterior pelo interruptor existente.

## Folga e validade

- Folga: nenhum job pendente de prioridade maior já vencido para **o mesmo número**. Um job bloqueado por uma etapa anterior ainda conta; não atravessar um job mais importante só porque está temporariamente bloqueado ou reservado por outra transação.
- D 25/45 min aguardando prioridade maior registra `aguardando_folga`. Só linhas realmente diferentes são atualizadas; lote limitado a 50.
- Ao ultrapassar **15 min de atraso**, essas etapas são puladas com `sem_folga_no_pico` se houve disputa registrada ou o teto horário foi consumido. O motivo significa: **“Etapa pulada: não houve espaço no ritmo de envio antes do prazo.”** Não é uma mudança na validade.
- Sem evidência de pico, atraso comum continua `late_step`, distinto do congestionamento. Nenhum histórico antigo é reclassificado.
- Expiração ocorre antes da trava do ritmo/teto horário, para não deixar lembretes secundários vencidos presos até a capacidade voltar.
- A reserva continua uma mensagem por número, com intervalo aleatório **20–60s**, teto **80/h** e **6 por cliente/dia**. Mensagens incertas não são reenviadas. Nenhuma live é repartida entre números.
- Regra de resposta do D, B/C “carrinho já contatado”, pagamentos, descadastro, janela Meta, atendimento humano e demais cancelamentos não foram alterados.

## Carga: 300 follow-ups vencendo ao longo de uma hora

**Composição explícita:** 75 primeiros D, 40 A, 40 B, 35 C, 10 E, 50 segundos D e 50 terceiros D. Chegadas uniformes. Para os D secundários, o envio anterior já consta como confirmado. Todos os 300 são elegíveis: não há pagamento, resposta, descadastro ou cancelamento simulado removendo candidatos.

**Dois números significa duas lives independentes**, cada uma com seu número fixo; não uma live espalhada entre números.

| Medida | 1 número / 1 live | 2 números / 2 lives |
|---|---:|---:|
| Primeiro D enviado dentro da validade | **75/75 (100%)** | **75/75 (100%)** |
| Atraso máximo do primeiro D | **5,10 min (5min06s)** | **1,06 min (aprox. 1min04s)** |
| Primeiros D enviados na primeira hora | 69 | 74 |
| A/B/C enviados na primeira hora | 2 / 0 / 0 | 40 / 34 / 0 |
| A/B/C enviados após drenar a fila | 40 / 40 / 35 | 40 / 40 / 35 |
| E após drenar | 10 | 10 |
| D 25 min enviado / sem folga | 0 / **50** | 0 / **50** |
| D 45 min enviado / sem folga | 0 / **50** | 0 / **50** |
| Pendências ao final | 0 | 0 |

“Após drenar” NÃO significa dentro da primeira hora: A/B/C não têm a validade de 15 minutos do D e podem atrasar horas no pico. O teste avança o relógio até seis horas depois do término das chegadas. Não escondemos o atraso das prioridades menores para apresentar o primeiro D como sucesso.

## Capacidade: o que pode e o que não pode ser garantido

**A nova ordem cumpre a meta na carga acima; não é garantia universal de 80 primeiros D/h.** Dois limites diferentes:

1. **Limite nominal anti-ban:** acima de **80 pedidos/h por número**, ou **81/h** em volume sustentado, nem só os primeiros D cabem no teto. Não aumentar o teto nem dividir a live entre números.
2. **Capacidade prática do worker existente:** roda com orçamento de 55s e exige 25s sobrando para iniciar envio. Logo, não começa nova reserva nos últimos 25s da execução. Com intervalo de 20–60s, o teto teórico de 80/h nem sempre é alcançado. Essa janela de execução NÃO foi modificada neste pedido.

Testando **somente os primeiros D**, chegadas uniformes, mesmo número, semente fixa:

| Pico | Enviados / previstos | Perdidos por validade | Maior atraso dos enviados |
|---|---:|---:|---:|
| 80/h por 2 horas | 160/160 | 0 | 14,10 min |
| 80/h por 6 horas | **421/480** | **59** | 14,89 min |
| 81/h por 2 horas | 160/162 | 2 | 14,85 min |
| 100/h por 2 horas | 142/200 | 58 | 14,98 min |

Varredura determinística de **65 a 85 pedidos/h por 6h:** 75/h foi o último caso sem perdas; **76/h foi o primeiro com perda**. Este valor é do cenário simulado, não um novo limite de negócio nem uma promessa de capacidade: lentidão do provedor, concentração das chegadas e mensagens inferiores que já consumiram o teto podem antecipar falhas. Nenhuma prioridade recupera vagas já gastas na última hora.

**Melhoria a aprovar separadamente:** revisar a janela útil de execução do worker e, se a garantia precisar cobrir picos tardios, reserva antecipada de capacidade para D inicial. Não implementado; nem aumento de ritmo, cron adicional, VPS ou envio multinumero.

## Testes e evidências técnicas

- `src/test/liveFollowupPriorityV2.database.sql` executa o **SQL real da reserva** em PostgreSQL local descartável, socket privado. Cron e provedor são simulados; não há chamadas externas nem dados reais.
- Tempo virtual troca apenas `now()` e `clock_timestamp()` na função local. Intervalo aleatório é amostrado pelo próprio PostgreSQL, `setseed(0.42)`; duração simulada do provedor: 6s/9s; orçamento e margem do laço: 55s/25s. Revalidação da validade na conclusão é conservadora.
- Casos: D inicial passa à frente de A mais antigo; FIFO na mesma prioridade; secundário não passa por prioridade maior bloqueada; depois da liberação envia; congestionamento tem motivo próprio; atraso isolado não vira pico; permissões exclusivas de serviço; v1 intacto; teto horário e drenagem; guardas de implantação com pedido/comentário recente.
- Testes antigos do laço v2, resposta/etapa, falha isolada e envio incerto permanecem sem alteração.
- Verificação focada final: **57 testes Vitest passaram**, incluindo **9 novos**; **7 testes Deno** existentes passaram. Suíte completa com os novos testes: **1.298 testes passaram em 191 arquivos**; após reforçar a precedência de evento desligado/limite diário, os 57 focados passaram novamente. Prévia: `build OK`.
- `EXPLAIN` de leitura em produção usa o índice existente `live_followup_jobs_due` para candidatos e verificação de maior prioridade. Sem índice ou tabela nova.
- Mudança acrescenta **duas consultas limitadas a 50 linhas** por chamada de reserva (registrar disputa e expirar secundários), e teste de existência de prioridade maior para D secundário; reaproveita o índice de histórico da instância para o teto. Nenhuma consulta de abertura de tela e nenhum polling novo.
- A implantação usa `docs/followups/PRIORIDADE-V2.sql`, com recusa transacional se houver pedido de live na última hora ou comentário nos últimos 30 min. Ainda não há migração aplicada/journal de produção deste pedido.

## Não testado e próximos passos

- Envio real, evento real de resposta/eco, queda real do provedor e carga concorrente real no banco de produção não foram exercitados.
- Concorrência de duas conexões reservando o mesmo número ainda não foi medida; a nova reserva trava o registro do número antes dos jobs e a verificação de folga não ignora jobs bloqueados. Não confundir essa evidência estrutural com teste concorrente.
- Após acabar a atividade da live, repetir a checagem e aplicar a mudança pelo mecanismo de migração; conferir helper v2, definição da reserva e interruptores. Não basta publicar o site e não é necessário publicá-lo para mudar o servidor.
- Aprovação adicional é necessária para mudar a janela útil do worker/reserva de capacidade e assegurar picos prolongados; a prioridade, sozinha, não elimina a limitação encontrada.