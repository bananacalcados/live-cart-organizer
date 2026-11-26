# Balanço geral por bipagem no celular (Fase 3) — plano

## 1. Como funciona hoje no computador

Hoje existem dois "balanços" diferentes.

**A) Estoque > Balanço > Iniciar Balanço (antigo)**
- Escopos: Total (zera tudo da loja que não foi bipado), Parcial (só confere o que foi bipado) e Total Inteligente (zera só os tamanhos não bipados dos modelos que tiveram ao menos um tamanho bipado).
- Cada bipe grava na hora uma linha da contagem. Código não achado vai para "Pendentes". Já lê a etiqueta nova (código interno da variação) e o código de fábrica.
- Ao finalizar, o saldo do PDV daquela loja é sobrescrito pelo contado. Cada mudança vira um ajuste com o saldo anterior e o novo.
- Fraquezas:
  - No Total, o próprio navegador baixa a loja inteira e insere os não bipados.
  - Não tem trava real contra duas contagens na mesma loja: a tela só abre a mais recente.
  - Não desconta vendas feitas durante a contagem.
  - Não tem botão Desfazer: o saldo anterior fica só no ajuste.
- Foi usado 3 vezes.

**B) Estoque > Inventário (novo, feito nas Fases 3/4)**
- Abrir um inventário na loja trava: só um aberto por loja.
- A contagem é feita por lotes de etiquetas no modo Balanço, cada lote com histórico em "Etiquetas e Balanços" e **Desfazer por lote**.
- O balanço desconta do contado os pedidos ainda na Expedição.
- O lote recusa contagem aberta há mais de 12 horas ("contagem expirada").
- O lote recusa loja de simulação.
- O "Zerar não contados":
  - roda no servidor, 100 por vez, com parada a qualquer momento;
  - exige digitar ZERAR e exige ao menos 1 item contado;
  - só fica liberado depois de um balanço real e um Desfazer de teste;
  - pode ser limitado a uma lista de variações.
- Relatório paginado e CSV ao encerrar.

**Loja hoje:**
- Pérola: 2.016 linhas, 1.605 com saldo e 3.718 pares.
- Centro: 1.093 linhas, 746 com saldo e 1.037 pares.
- Site/Live: toda em zero (regra da Pérola).

## 2. Proposta para o celular

Usar o **motor do Inventário (B)**, que já é seguro, trava a loja e desfaz. Nenhuma regra nova de saldo.

**Início (tela inicial do /m/estoque)**
- Botão grande "Balanço por bipagem", e depois escolha da loja (só Centro e Pérola).
- Se a loja já tem inventário aberto, aparece "Retomar inventário #N", com quem abriu e quando. Se não tem, "Abrir inventário".
- Escolha do escopo, explicado na seção abaixo.

**Contagem**
- Campo sempre focado, para o leitor físico, e botão de câmera.
- O código é reconhecido pela mesma busca do computador (etiqueta nova, código de fábrica e SKU).
- O último item aparece em destaque, com foto, cor, tamanho e quantas unidades já foram contadas, além do total de pares.
- Também tem:
  - botões "Desfazer último bipe" e "Editar quantidade";
  - bipe curto e vibração no acerto, som diferente no erro.
- Código não reconhecido vai para a lista "Não reconhecidos" e a contagem continua. Essa lista nunca zera nada, só aparece na conferência.
- **Internet instável:** os bipes ficam guardados no aparelho e vão para o servidor em lotes a cada ~20 bipes ou 30 s, mandando sempre o **total acumulado** de cada variação.
  - Como o modo Balanço define o saldo final e não soma, reenviar o mesmo lote não duplica nada.
  - Sem internet, o celular continua contando e mostra "N bipes aguardando envio".
  - Concluir fica bloqueado enquanto houver bipe sem enviar.
- Não tem atualização automática: a tela só fala com o servidor ao enviar lotes e ao abrir a conferência.

**Conferência obrigatória antes de zerar** (lida no servidor, que é a mesma fonte do relatório do Inventário)
- Quantas variações e pares foram contados.
- **Quantas variações e pares serão ZERADOS**, com lista pesquisável e valor em custo e em venda.
- Diferenças entre o contado e o sistema.
- Quantos ficaram em "Não reconhecidos" e quantos bipes estão pendentes (este número precisa ser 0).
- Confirmação dupla:
  1. um botão "Revisei a lista";
  2. digitar o número exato de pares que serão zerados, e o servidor ainda exige ZERAR.
- Escopos:
  - **(b) Só os produtos com algum tamanho bipado: PADRÃO RECOMENDADO.** Zera só os tamanhos esquecidos de modelos que você contou. Concluir cedo demais não zera a loja.
  - (a) Loja inteira: só com o aviso extra "Isto zera X pares da loja toda".
  - (c) Por marca ou categoria escolhida no início: precisa de um pequeno ajuste no servidor, que já recebe a lista de variações. Sugiro deixar para depois.
- O zeramento roda 100 por vez, com barra de progresso e botão Parar, exatamente como no computador.

**Depois de concluir**
- Relatório do inventário (o mesmo do computador), com CSV.
- **Desfazer já existe por lote.** Proposta: um botão "Desfazer este balanço" que desfaz, em ordem, todos os lotes do inventário, inclusive o zeramento. Vale por X dias (o Matthews define) e só quando nenhum lote mais novo mexeu nas mesmas variações. Se algo vendeu no meio, aquele item é pulado e listado.

## 3. Riscos

- **Zerar a loja por engano:** o padrão (b) só toca nos modelos tocados. A opção (a) tem aviso extra e confirmação pelo número de pares. Com zero contados, o servidor já recusa.
- **Bipe perdido na queda de internet:** a fila fica no aparelho, o reenvio é sem duplicar e concluir fica bloqueado com pendências. Risco restante: limpar os dados do navegador antes de enviar.
- **Duas pessoas:** a loja só tem um inventário aberto. Duas pessoas no mesmo inventário podem contar juntas, mas a mesma variação em dois celulares fica com o último total enviado. Proposta: aviso "esta variação foi contada por outra pessoa".
- **Vendas no PDV durante a contagem:** o lote desconta a Expedição pendente. O que vende entre o bipe e o envio do lote é coberto pelo envio frequente (~30 s). Vou conferir no servidor se as vendas feitas depois da abertura também são descontadas, antes de construir.
- **Site/Live baixa da Pérola:** a conferência nunca oferece a loja Site/Live. A contagem da Pérola é feita com as vendas online já baixadas dela, e o gatilho de redirecionamento não é tocado.
- **Produto sem etiqueta:** o código de fábrica e o SKU funcionam. Sem código nenhum, vai para "Não reconhecidos". Se não for bipado, entra na lista de zerados e aparece na conferência.
- **Desempenho:** no pior caso da Pérola, até ~1.600 linhas zeradas em ~16 chamadas de 100, com pausa de 1,5 s (menos de 1 minuto). Os lotes de contagem chegam a no máximo 200 variações por chamada. Sem polling e sem cron.

## 4. Técnica

**Migração**
- Para (a) e (b): nenhuma. Os servidores atuais já recebem a lista de variações.
- Opcional, depois do OK: uma função para desfazer o inventário inteiro em ordem, verificando acesso de Estoque, com limite de dias. Opcional também o filtro de marca/categoria.

**Arquivos**
- Novos em `src/mobile/inventory/`:
  - tela do balanço;
  - fila local;
  - lógica pura (somar bipes, montar lotes, montar a lista de zerados do escopo b).
- O que hoje está preso na tela do Inventário (abrir, retomar, resumo, zerar) passa para uma lib, com o computador usando a mesma lib.
- Testes antes e depois provando que o computador manda exatamente as mesmas chamadas.

**Testes**
- Lógica pura:
  - somar e desfazer bipe;
  - reenvio sem duplicar;
  - bloqueio com pendências;
  - escopo (b) não incluindo modelos não tocados.
- Em transação desfeita no banco: abrir inventário, enviar 2 lotes, reenviar o mesmo lote, zerar escopo (b), desfazer, e conferir que a segunda abertura na mesma loja é recusada. A loja de simulação é recusada pelo servidor, então o teste usa uma loja real dentro de rollback.
- No celular, 390x844, com gravação simulada: abrir, bipar, ficar sem internet (simulado), reenviar, conferência e confirmação.

**Não conseguirei testar:** leitor físico de verdade, câmera, vibração e som no aparelho, queda real de Wi-Fi na loja, balanço real com zeramento.

## 5. Perguntas para o Matthews

1. Padrão de escopo: concorda com (b) "só os produtos que tiveram algum tamanho bipado"? Libero também (a) "loja inteira"?
2. Desfazer o balanço inteiro: por quantos dias deve ficar disponível (ex.: 2 dias)?
3. Quem pode concluir e zerar pelo celular: todo mundo do Estoque ou só admin?
4. Duas pessoas contam a mesma loja ao mesmo tempo (ex.: cada uma num corredor), ou é sempre uma só?
