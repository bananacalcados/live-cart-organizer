# Carrinhos manuais sem follow-up — investigação de 28/11/2026

## Resultado

**Causa comprovada antes do agendador:** o gatilho compartilhado `live_followup_dirty` acessa `NEW.order_ids`, campo que existe no acesso online, mas não em `orders`. A exceção desfaz a inserção da fonte dentro do bloco e devolve o pedido normalmente. Assim, o carrinho é enviado, o carimbo fica salvo e nenhuma fonte chega ao agendador. Não é exigência de cadastro online, filtro B/C nem erro silencioso no upsert de jobs.

**Correção preparada, NÃO aplicada.** Nenhuma alteração em funções de produção, dados de clientes, fontes, jobs, cron, enviador, desktop ou mobile. Nenhuma mensagem real. Interruptor continua `v2`; fontes de produtos continuam ERP e redirecionamento mobile continua `off`.

## 1. Provas e data

### Definição realmente implantada

Consultado `pg_get_functiondef` em produção e preservado em:

- `prepared/live_followup_dirty-production-20261128.sql`;
- `prepared/live_followup_source_contexts-production-20261128.sql`.

Trecho defeituoso, correspondente à linha 2 de `drizzle/migrations/0150_followup_cutover_and_atomic_simulation.sql`:

```sql
IF TG_TABLE_NAME='live_selfservice_accesses' AND cardinality(NEW.order_ids)>0 THEN
  -- enfileirar pedidos vinculados
END IF;
```

Em PostgreSQL, a resolução do campo do registro acontece ao preparar essa expressão: o primeiro lado do `AND` não protege o acesso a um campo inexistente. Em um trigger de `orders`, resulta em:

```text
[live-followup-dirty] record "new" has no field "order_ids"
```

O final da função captura `WHEN others`, emite `WARNING` e retorna `NEW`. O bloco com tratamento de exceção funciona como uma subtransação: a inserção anterior em `live_followup_sources` é desfeita junto com a falha; a atualização externa do pedido continua. **O pedido é perdido na condição acima, não no ACK do agendador.**

O hash SHA-256 do arquivo 0150 é `90c82ad25cddb4f4c2480d40ad1bbffdbfe774e35448571e0e41cb201ba87d19`. Ele corresponde à entrada implantada 152 do journal, com `created_at=1794161372120`: **08/11/2026 às 18:09:32.120 UTC**. O commit que introduziu o arquivo é `e84fae293`, às 18:09:35 UTC. O primeiro carrinho manual sem acesso/sem job encontrado no recorte atual foi em **12/11 às 21:28:30.714 UTC**; não confundir primeira evidência de pedido com início do defeito.

### Logs

- Logs do banco: 40 avisos com a assinatura `live-followup-dirty.*order_ids` no trecho retornado entre 17:19:54.532 e 17:29:08.458 UTC. O armazenamento de logs devolveu apenas esse trecho recente mesmo com filtro de 30 dias; não fornece uma data histórica confiável do primeiro aviso.
- `event-followup-scheduler`: chamadas HTTP 200, sem erro, com duração observada de 313–1.416 ms na primeira leitura. Agendador e enviador registraram batimentos positivos, sem último erro.
- A versão executada do agendador, lida nos metadados dos logs, é **1741**. Nove chamadas dessa versão foram retornadas entre 17:22:44 e 17:30:07, zero HTTP >=400.
- Os logs textuais da função mostraram apenas inicialização/finalização; não há mensagem individual para fonte que nunca chegou. A busca específica por aviso às 16:38 não devolveu registro no trecho retido. **Não inventar correlação individual de log nesse horário.**
- Limite da leitura de versão: confirmou-se a versão executada e leu-se o código SQL implantado que contém a causa. As ferramentas disponíveis não forneceram o bundle remoto da Edge Function 1741; o código TypeScript foi lido no repositório, não apresentado como download desse bundle.

### Caso informado

Pedido `001e06c5-a0b8-4323-9a2c-27e760729613`: carrinho manual às 16:38:17.935 UTC, sem acesso, `selfservice_cart_sent_at` nulo, telefone válido na ficha e no cliente, um produto, estágio `awaiting_confirmation`, não pago na leitura. Zero fontes e zero jobs.

Pedido anterior `669ad532-ecf2-48c9-9da2-e6682fd724a2`: link às 16:15:55.996 UTC, pago às 16:21:20.874 UTC. Também zero fontes/jobs, mas o pagamento em menos de 10 minutos significa que **não deveria receber a cobrança D10**. O pedido anterior pago não impede classificar o segundo quando ambos não têm acesso vinculado.

### Por que o acesso online mascara a falha

O gatilho executado sobre `live_selfservice_accesses` encontra `order_ids`, termina sem exceção e enfileira o próprio acesso e os pedidos vinculados. O caminho de reconciliação do acesso também faz essa alimentação. Sem acesso, não existe essa segunda oportunidade. A consulta em lote usa `LEFT JOIN` para acesso e ficha: não exige acesso para D. Ela expõe corretamente o carimbo manual em `selfservice_cart_sent_at`/`cart_sent_at`.

`scheduleGlobalFollowups`, linha 51 da versão local, classificaria esse contexto como D. O upsert, linha 110, lança em caso de erro antes de confirmar/remover a fonte; portanto não é o silêncio observado neste caso.

## 2. Impacto por live — últimos 30 dias

Recorte fixo: **29/10/2026 17:26 até 28/11/2026 17:26 UTC**. Pedidos de evento, com carrinho enviado, `origin IS DISTINCT FROM 'catalog'` — incluir `origin` nulo é indispensável para os casos informados. Não usar `origin <> 'catalog'`, que excluiria os nulos.

| Live | Sem acesso online | Sem acesso e sem qualquer job | Sem D e pagamento depois de 10 min ou ausente* |
|---|---:|---:|---:|
| 12/11 Pérola | 2 | 1 | 1 |
| 14/11 Site | 20 | 19 | 9 |
| 16/11 Pérola | 14 | 14 | 8 |
| 18/11 Pérola | 7 | 7 | 3 |
| 21/11 Site | 11 | 10 | 7 |
| 24/11 Pérola | 11 | 11 | 8 |
| 25/11 Pérola | 12 | 11 | 8 |
| 27/11 Pérola | 3 | 3 | 1 |
| 28/11 Site | 10 | 9 | 6 |
| **Total** | **90** | **85** | **51** |

*Indicador de oportunidade perdida de D, não prova de 51 envios autorizados: exige produtos, não unificado e pagamento ausente/após 10 min; o histórico completo de opt-out, respostas, fechamento e atendimento humano no instante exato não foi reconstruído. As 85 ausências de job são observadas; a causa do caminho de gatilho foi reproduzida. Não atribuir cada ausência histórica exclusivamente ao defeito sem ressalvar as outras proteções.

Nos últimos 10 dias, a consulta reproduziu **54 sem acesso, 3 com algum job e 1 com D**. O indicador de pagamento >10 min/ausente deu **33**, não os 34 informados; ficam registrados ambos, sem ajustar o resultado para forçar igualdade. O total com acesso não é usado para inferir perda desse caminho.

Consulta de diagnóstico por evento: `EXPLAIN ANALYZE` em produção, somente leitura, **3,792 ms**, 57 carrinhos no evento, usando `idx_orders_event_id`, `live_followup_access_order_lookup` e `live_followup_jobs_order`. O levantamento histórico é uma auditoria pontual, não consulta recorrente nem download de pedidos para o navegador.

## 3. Correção preparada e teste antes/depois

Artefatos em `docs/followups/prepared/`, fora das migrações automáticas e sem importação por funções em produção:

1. **`MANUAL-CART-FIX.sql`**: preserva a função existente e transforma o `IF` combinado em dois `IF`s aninhados. Nenhum campo exclusivo de acesso é resolvido durante um trigger de pedido.
2. **`manual-cart-scheduler.ts`**: cópia preparada do agendamento atual, com uma única proteção nova de D: confirmar/remover a fonte, sem criar jobs, se o contexto informar `manual_cart_before_cutover=true`.
3. No mesmo SQL, o contexto passa a incluir esse booleano calculado com um **horário de corte fixo da aplicação**, somente para carrinhos manuais não-catalog, com `selfservice_cart_sent_at` nulo. A informação não muda telefone, instância, horário-base ou nenhuma linha de job.

O teste `src/test/liveFollowupManualCart.database.test.ts` usa PostgreSQL descartável via socket privado. Carrega as definições SQL realmente lidas em produção; depois passa os contextos reais desse banco ao agendador com gravações de jobs apenas em memória e nenhuma chamada de transporte.

- Sem a correção: pedido permanece, zero fontes; o teste de D do pedido recorrente e o da atendente falham, como esperado. Primeira execução: 2 testes passaram e 5 falharam por ausência das fontes/contextos.
- Com a correção preparada: **13 testes passaram**, incluindo os mesmos casos positivos, 3 etapas D, telefone/chave/instância exatos, acesso online como caminho alternativo, fonte de carrinho antigo descartada, jobs antigos intactos, B/C inalterados e recusa de aplicação sem autorização/guarda ou durante live.
- Regressões: **70 testes passaram** em quatro arquivos, incluindo prioridades/carga SQL, regras B/C/D e escopo de cancelamento; **8 testes Deno de execução passaram**, incluindo a regra D por etapa, envio incerto e isolamento de erro Instagram.
- A execução Deno com verificação de tipos foi bloqueada por sete erros preexistentes nos utilitários de autenticação/log. A execução acima usou `--no-check`; não equivale a aprovação da verificação de tipos desses utilitários. Não alterados para não misturar mudanças ao pacote preparado.

### Importante: a trava de 60 minutos NÃO basta

A trava existente verifica idade da base **maior que 60 min**. Um carrinho manual enviado 20 minutos antes da aplicação ainda passaria e poderia ganhar D atrasado quando o pedido fosse atualizado. O teste demonstra isso: o agendamento antigo cria 3 D para base de 20 min; a versão preparada, com corte explícito, cria zero. A trava >60 min permanece adicionalmente intacta.

**Efeito proposto:** os novos agendamentos D desse caminho manual só entram para carimbos enviados **a partir do horário de corte**. Carrinhos manuais anteriores, mesmo com base menor que 60 min, não são recuperados por alteração de etapa nem por uma fonte já pendente. Não fazer varredura/reagendamento do histórico; não mudar carimbos antigos. Reenviar um link cujo primeiro carimbo já existe não renova sua base.

Jobs já enviados, cancelados e pendentes continuam exatamente como estavam; não são convertidos, reagendados nem reenviados. A proteção corta novas tentativas de agendamento de carrinhos antigos, não apaga jobs antigos que já existem.

### Aplicação futura — somente após autorização

1. Revisar o bundle efetivo do agendador na implantação, já que o download dele não esteve disponível nesta investigação.
2. Levar **somente a guarda de corte** da cópia preparada para o agendador real e implantá-la primeiro. Sem a informação nova no contexto, essa guarda não altera comportamento.
3. Depois de confirmar essa versão, executar o SQL que troca o gatilho e acrescenta o corte ao contexto **na mesma transação**. Nunca consertar o gatilho antes de implantar a guarda: isso abre janela de retroativos.
4. O SQL exige autorização específica e confirmação de revisão do agendador. Por padrão recusa atividade de live nos últimos 30 minutos; liberação com live exige outra autorização explícita. Não executar agora.
5. Registrar horário UTC do corte e observar fontes, D10, cancelamentos legítimos, atraso e ritmo. Manter `v1/v2` em `v2` e teto 80/h, 20–60 s, número próprio de cada live.

Risco com live: novos carrinhos passam a efetivamente alimentar a fila, aumentando a demanda; a prioridade/limite permanece a mesma e capacidade não é promessa de envio de todos no pico. Há também o risco de ordem de implantação e fontes anteriores ao corte; os testes cobrem o corte, mas não tráfego simultâneo real nem entrega/eco do provedor. Não foi liberada implantação.

Rollback: recuperar a definição anterior do gatilho preservada nesta pasta, mantendo **a guarda de corte e o corte do contexto** para não reabrir retroativos. Não remover a guarda durante a live, não reverter dados e não mexer em jobs. Restaurar todo o contexto anterior sem avaliar as fontes pendentes reabriria o risco de carrinhos antigos.

### Limites adicionais encontrados, não misturados à correção

Um segundo pedido **com acesso compartilhado** pode sofrer outra proteção, `linked_closed`, que examina um pedido anterior pago. Também existe a base antiga do acesso em B/C. Esses casos são distintos do exemplo informado, que não tem acesso. A correção cobre segundo pedido da mesma cliente **sem acesso**, como o caso concreto; não altera essas outras regras nem anuncia resolvê-las. Mudança nelas precisa de revisão/escopo próprio.

## 4. Futura Fila de disparos

**Uma união apenas das tabelas de filas não mostraria esse caso**, pois não existe linha para unir. O alarme atual também pode continuar verde: trabalhadores saudáveis, zero job vencido, apesar de pedido perdido antes da fila.

Requisito registrado no roadmap da entrega 3:

- Acrescentar uma origem de leitura de **pedidos com carrinho enviado e sem qualquer job**, não apenas uma união de filas.
- Colunas: cliente, evento, instância da live, horário do carrinho, tempo sem agendamento e motivo **“Carrinho enviado sem acompanhamento agendado”**.
- Classificar como alerta de agendamento ausente, distinto de envio atrasado/worker parado; trazer o pedido mesmo se não existir fonte pendente.
- Priorizar alerta operacional para pedido aberto, com produtos e contato, que não pagou dentro de 10 min. Exibir situações encerradas no histórico sem avisar cobrança indevida; listar razões de não elegibilidade quando verificáveis (pago, desligado, contato ausente etc.).
- Mesma permissão/paginação da futura tela, consulta no servidor, 50 por página, índice de evento e anti-join pelo índice `live_followup_jobs_order`; filtros e contadores devem incluir esse alerta.
- Não implementar ação/reagendamento ao abrir a tela. Essa entrega continua posterior às duas entregas já aprovadas; não foi implementada agora.

## Não testado / pendências

- Transporte, eco e recebimento por cliente real: não testados e proibidos neste pedido.
- Bundle remoto do agendador: versão confirmada, conteúdo remoto indisponível pelas ferramentas de leitura.
- Verificação de tipos Deno dos utilitários existentes: bloqueada pelos sete erros descritos; testes de execução passaram sem essa verificação. Prévia informou build OK.
- Histórico completo de todas as proteções para cada um dos 51 casos: não reconstruído.
- Implantação e concorrência em live real: não realizadas; dependem do ok explícito de Matthews.
- Tela/alarme de ausência de agendamento: requisito registrado, implementação continua na entrega 3.
- Publicação do site: nenhuma mudança de tela nesta investigação; não publicar. A correção exige implantação separada do servidor, autorizada, não mera publicação do site.