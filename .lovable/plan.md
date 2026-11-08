# Auditoria do fluxo de TROCA (só leitura)

Nada foi alterado. Este relatório traz como o sistema funciona hoje e, no final, uma sugestão de próximos passos para você aprovar ou não.

## 1. Passo a passo

O site e a loja física usam o mesmo motor. As telas mudam: "Nova Troca" para o site, "Troca Presencial" para quem está no balcão e "Finalizar Troca" para o fim do processo.

### Etapa 1 — Abrir a troca
Tela "Nova Troca" (`NewExchangePicker.tsx` → `createNewExchange` em `src/lib/pos/newExchange.ts`).
- Cria a troca com um código TD-2026-xxxxxx (gerado por gatilho no banco) e os itens: o que volta e o que vai de reposição.
- O item de reposição fica marcado como "reservado" (modo aguarda retorno) ou "despachado" (modo despacho antecipado). **Essa marcação é só um rótulo: o estoque não muda.**
- Logística reversa: o código dos Correios é **digitado à mão** no campo "postagem reversa". A reversa nova dos Correios (aba do chat do PDV) é um fluxo separado, sem ligação com a troca.
- Gera um PDF de instrução para a cliente.
- Situação inicial:
  - "aguardando retorno", na maioria dos casos;
  - "recebido/conferência", se for loja física com o produto em mãos.

### Etapa 2 — Finalizar (conferir o que voltou)
Tela "Finalizar Troca" (`FinalizeExchangePicker.tsx` → `finalizeExchange` em `src/lib/pos/finalizeExchange.ts`).
1. Grava a conferência: o item volta como vendável ou avariado.
2. Emite a **NF-e de devolução** (finalidade 4, entrada, ligada à chave da nota original), pela função `nfe-devolucao-emitir`, sempre no mesmo CNPJ da nota original.
   - Se a venda original não tem nota, ela pula e segue sem nota.
   - Se a SEFAZ rejeita, **para tudo aqui**: não mexe no estoque nem no pedido e grava o erro. A troca fica em "recebido/conferência" até alguém tentar de novo.
3. Dá entrada no estoque dos itens vendáveis que voltaram.
4. Pedido original: em troca, **nunca é cancelado**. Só a devolução total cancela o pedido.
5. Diferença de valor: se a cliente paga mais, a diferença vai como faturamento para a vendedora (no site não há vendedora). Se a diferença é a favor da cliente, gera voucher ou estorno no caixa.
6. Cria a **"venda-espelho" da reposição**, uma nova venda no PDV com tipo "troca":
   - o preço cheio dos produtos novos entra como subtotal;
   - o crédito do produto devolvido entra como **desconto**;
   - o total fica só com a diferença.
   - Ao entrar os itens dessa venda, o gatilho de estoque **dá baixa no produto novo**.
7. A troca passa para **"aguardando envio"**.

### Etapa 3 — Nota do produto novo
Na mesma tela, o botão "Emitir NF-e" gera a nota de saída da venda-espelho, pela função `nfe-emitir`.

### Etapa 4 — Rastreio e aviso
Na mesma tela, a pessoa digita o rastreio e clica em "Enviar WhatsApp e concluir". Só aí acontece:
- o rastreio é gravado na troca e na venda-espelho;
- a mensagem vai para a cliente pelo WhatsApp;
- a data do aviso é registrada;
- a troca vira **"concluída"**.

**Loja física (Troca Presencial):** o sistema faz as etapas 1 e 2 de uma vez, e a troca também termina em "aguardando envio". Não existe um botão para "cliente levou na mão", então ela fica parada ali.

## 2. A venda de reposição passa pela Expedição?
**Não. A resposta é a (a).**
- A venda-espelho nasce com tipo "troca". O gatilho `set_pos_sale_expedition_stage` dá "concluído" para todo tipo que não seja live ou online.
- A aba Expedição só busca vendas live e online, então a venda-espelho **nunca aparece lá**.
- O "pending" em expedition_status é só o valor padrão da coluna, que nunca é atualizado. Não quer dizer nada.
- O produto novo é despachado **por fora do sistema**. O rastreio só seria gravado na etapa 4, que quase ninguém faz. Os 8 registros de rastreio foram criados à parte.

## 3. O que é "aguardando envio" e por que tem 122 paradas
Significa: a nota de devolução está resolvida e a venda-espelho foi criada, mas faltam a nota do produto novo e/ou o rastreio com o aviso.

O único código que leva a troca para "concluída" é o botão "Enviar WhatsApp e concluir" (`FinalizeExchangePicker.tsx`, linhas 840–863). As outras mudanças de situação são estas:
- "aguardando retorno" e "recebido/conferência" são definidos na criação da troca;
- "recebido/conferência" também aparece quando a nota de devolução fica em contingência;
- "aguardando envio" é definido ao finalizar.

**Por que travaram:**
- 71 das 122 são de **loja física**. A cliente levou o produto na mão, não existe rastreio para digitar e não há botão de "entregue no balcão". Elas ficam paradas para sempre.
- As do site ficam paradas porque o despacho é feito fora do sistema e ninguém volta na tela para digitar o rastreio.
- **Não existe sincronização** entre o rastreio ou a Expedição e a situação da troca. Por isso o rastreio da troca está sempre vazio.

## 4. Notas fiscais

**O que está certo:**
- Nenhuma troca tem duas notas de devolução autorizadas.
- Nenhuma venda-espelho tem duas notas de saída autorizadas. As duas funções têm trava para não reemitir quando já existe nota autorizada.

**Achados importantes:**
- **A nota do produto novo sai com desconto do crédito.** Das 95 notas de reposição autorizadas:
  - 44 saíram com valor **R$ 0,00**;
  - 60 saíram abaixo do preço do produto;
  - somadas, dão R$ 17.005,88, contra R$ 34.348,91 de produtos.

  Como a nota de devolução já anulou a venda original para o fisco, o produto novo pode estar saindo sem imposto ou com imposto menor. **Isso precisa ser confirmado com o contador.**
- **15 trocas do site "concluídas" no modo despacho antecipado não têm venda-espelho.** Isso vem de um erro antigo, já corrigido no código. Para essas 15:
  - não existe nota do produto novo;
  - não foi dada baixa no estoque do produto novo.
- **As 4 trocas sem nota de devolução** (TD-000020, 022, 049 e 112) estão corretas: a venda original não tinha nota autorizada, então não havia o que devolver para o fisco.
- **Quando a nota de devolução é rejeitada:**
  - não há nova emissão automática;
  - a troca fica travada em "recebido/conferência" até alguém clicar de novo, e cada tentativa cria uma nota nova;
  - nesse tempo, estoque e pedido não mudam;
  - no modo despacho antecipado, porém, o produto novo pode já ter saído **sem nota nenhuma**.

### Trocas com pendência fiscal

| Troca | Canal | Modo | Situação | Pendência |
|---|---|---|---|---|
| TD-000004 (faa671e8) | site | antecipado | aguardando retorno | devolução rejeitada 2x: UF da cliente vazia |
| TD-000027 (099e34a1) | site | antecipado | aguardando retorno | devolução rejeitada: código do município inválido |
| TD-000002 (036887f3) | física | aguarda retorno | recebido/conferência | devolução rejeitada 2x: CST do PIS inválido |
| TD-000003 (45d3fdf8) | física | antecipado | recebido/conferência | devolução rejeitada 3x: UF vazia |
| TD-000007 (6d87a8c4) | física | antecipado | recebido/conferência | devolução rejeitada 2x: UF vazia |
| TD-000040 (7b91de61) | física | antecipado | recebido/conferência | devolução rejeitada: erro no XML (logradouro) |
| TD-000168 (f988768f) | física | antecipado | recebido/conferência | devolução rejeitada 3x: valor maior que a nota original |
| TD-000001, 031, 038, 043, 044, 072, 082, 090, 095, 096, 097, 174, 188 | física | misto | aguardando envio | sem nota do produto novo |
| TD-000085, 086, 098, 099, 100, 101, 103, 110, 111, 141, 162, 170, 197 | site | misto | aguardando envio | sem nota do produto novo |
| TD-000020, 022, 049, 112 | física | misto | aguardando envio | sem devolução (correto: venda original sem nota) |
| TD-000008, 102 | física e site | antecipado | aguardando envio | ok; houve 2 e 3 rejeições antes de autorizar |

O caso "valor maior que a nota original" provavelmente acontece porque a devolução usa o preço da venda, e não o valor da nota com desconto ou frete. Para confirmar, é preciso ler o XML da nota original.

## 5. Aviso para a cliente
- **Existe**, mas só no clique manual "Enviar WhatsApp e concluir" (etapa 4). Não há rotina automática.
- Como ninguém chega a essa etapa, a data do aviso está vazia em todas as trocas.
- A loja física nunca precisaria desse aviso, e justamente ela não tem outra forma de concluir.

## 6. Riscos
1. **Imposto menor ou zerado no produto novo:** a nota de reposição sai com o crédito como desconto, com 44 notas de R$ 0. Esse é o risco fiscal principal. Não vi imposto pago em dobro: a devolução anula a nota original e a nova nota sai sem o crédito.
2. **Produto despachado sem nota:**
   - no modo antecipado, o produto novo sai antes da nota de devolução e da nota de reposição, que só existem depois que o produto volta;
   - hoje, 10 trocas antecipadas ainda não finalizadas já têm itens marcados como "despachado";
   - nas 26 trocas em "aguardando envio" sem nota de reposição, se o produto já saiu, saiu sem nota.
3. **Nota de devolução sem o produto ter voltado:** a tela de finalizar já vem com todos os itens marcados como "confirmado". Se alguém finalizar uma troca antecipada antes do pacote chegar, a nota de devolução é emitida sem retorno físico. O código não impede isso.
4. **Estoque errado no modo antecipado:**
   - o estoque do produto novo **não baixa** quando ele é enviado; só baixa ao finalizar, quando a venda-espelho é criada;
   - enquanto isso, o estoque mostra uma peça que já saiu;
   - se o produto antigo nunca voltar, a baixa do novo nunca acontece;
   - nas 15 trocas do site concluídas sem venda-espelho, a baixa nunca aconteceu.
5. **Reversa dos Correios em duplicidade (risco futuro):** a reversa nova também emite nota de devolução para a mesma venda. Ela não está ligada à troca, então a mesma venda pode acabar com duas notas de devolução. Hoje esse caso não aparece no banco, mas o caminho está aberto.

## O que não dá para confirmar só pelo sistema
- Se as 122 trocas paradas já foram despachadas ou entregues de fato. Isso depende de conferir fisicamente ou no balcão.
- Se a nota com crédito como desconto está correta para o fisco. Isso depende do contador.
- O motivo exato de "valor superior à nota devolvida". Isso depende de comparar com o XML da nota original.

## Próximos passos sugeridos (só se você aprovar; nada é feito agora)
1. Botão "Entregue no balcão" para as trocas da loja física, concluindo sem rastreio. Isso destrava 71 trocas.
2. Ligar o rastreio e a entrega da venda de reposição à situação da troca.
3. Depois da resposta do contador, emitir a nota de reposição pelo valor cheio, deixando o crédito só no financeiro.
4. Modo antecipado: dar baixa no estoque e emitir a nota do produto novo **no envio**, e só emitir a devolução quando o pacote chegar de verdade.
5. Ligar a reversa dos Correios à troca, para nunca emitir duas devoluções.
6. Tratar as 15 trocas do site sem venda-espelho e as 7 com devolução rejeitada, principalmente as de UF ou município vazios no cadastro da cliente.
