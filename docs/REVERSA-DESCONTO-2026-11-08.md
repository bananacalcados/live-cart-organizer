# Conferência fiscal da reversa — 08/11/2026

## Resultado principal

O problema descrito não se confirmou nos oito casos consultados: as notas das TD-184, TD-191 e TD-194 **já contêm o desconto da venda**, tanto no pedido enviado ao emissor quanto no XML autorizado. Aplicar novamente 10% ou 35% produziria desconto em dobro.

- TD-184 e TD-194: bruto R$ 359,99 − desconto R$ 36,00 = **R$ 323,99**. O XML registra vDesc=36,00 e vNF=323,99.
- TD-191: bruto R$ 399,99 − desconto R$ 139,99 = **R$ 260,00**. O XML registra vDesc=139,99 e vNF=260,00.
- Os itens da troca também guardam R$ 323,99 / R$ 260,00 / R$ 323,99 respectivamente. R$ 291,59 e R$ 169,00 seriam uma segunda aplicação do desconto; não foram adotados.

## O que mudou

Implantada somente **nfe-devolucao-emitir**. Nenhuma alteração no front-end ou em correios-reverse.

1. Troca e reversa agora usam a mesma função pura de cálculo por item: preço original × quantidade, menos desconto proporcional (desconto da venda ÷ bruto dos itens da venda), com arredondamento a centavos. Essa regra já existia no emissor; foi centralizada, não duplicada.
2. Na reversa, a busca do item prioriza o identificador exato do item da venda, preservando o casamento anterior por SKU/código de barras.
3. Quando a troca não encontra o item original, seu valor salvo, que pode estar líquido, não recebe novamente o desconto da venda. Esse era um caminho possível de desconto duplicado; não ocorreu nos três casos, cujos SKU/código de barras correspondem à venda.
4. A prévia dry_run agora calcula mesmo quando a reversa já tem nota autorizada e retorna bruto, desconto, líquido e produtos, antes de qualquer gravação ou chamada externa.
5. Se a trava identificar divergência e uma nota autorizada vinculada à reversa realmente corresponder ao bruto sem desconto, a resposta mostra: “A nota da reversa (...) saiu sem o desconto da venda. Fale com o fiscal para conferir a nota já emitida; o sistema não vai cancelar nem emitir outra nota.” Outros motivos de divergência mantêm o aviso anterior, sem diagnóstico falso.

Frete não foi somado: o cálculo anterior da devolução não o incluía. Os descontos por item/preços fiscais já incorporados ao preço continuam preservados. Não foram alterados o cálculo de estornos, a NF de saída da reposição, a live nem a trava `_shared/devolucao-guard.ts`.

## Tabela solicitada

Valores obtidos por leitura SQL e reproduzidos executando o código real da função em dry_run local, com banco simulado e gravações/chamadas externas proibidas. “Banco” é o valor pago salvo nos itens da reversa, conferido contra o rateio dos itens da venda.

| TD | NF da reversa | Valor atual | Regra compartilhada | Itens com desconto no banco |
|---|---:|---:|---:|---:|
| TD-2026-000181 | 3025 | R$ 359,99 | R$ 359,99 | R$ 359,99 |
| TD-2026-000182 | 3028 | R$ 359,99 | R$ 359,99 | R$ 359,99 |
| TD-2026-000183 | 3031 | R$ 459,99 | R$ 459,99 | R$ 459,99 |
| TD-2026-000189 | 3026 | R$ 359,99 | R$ 359,99 | R$ 359,99 |
| TD-2026-000191 | 3030 | R$ 260,00 | R$ 260,00 | R$ 260,00 |
| TD-2026-000184 | 3027 | R$ 323,99 | R$ 323,99 | R$ 323,99 |
| TD-2026-000193 | 3029 | R$ 359,99 | R$ 359,99 | R$ 359,99 |
| TD-2026-000194 | 3024 | R$ 323,99 | R$ 323,99 | R$ 323,99 |

TD-181/182/183/189/193 têm desconto zero: valores inalterados. TD-194 possui duas reversas usando a mesma nota; não são duas notas nem dois valores a somar.

## Notas indicadas para o contador

Não foram classificadas como erradas porque venda, XML e valor líquido coincidem. Seguem identificadores para revisão independente, sem corrigir ou vincular nada:

| TD | Nº NF | Valor emitido | Valor correto pela venda | Reversa vinculada |
|---|---:|---:|---:|---|
| 184 | 3027 | R$ 323,99 | R$ 323,99 | AP708428514BR |
| 191 | 3030 | R$ 260,00 | R$ 260,00 | AP708460157BR |
| 194 | 3024 | R$ 323,99 | R$ 323,99 | AP708051890BR e AP708060891BR |

**Chaves de acesso:**

- NF 3027 / TD-184: `31261116941125000156550010000030271038049724`
- NF 3030 / TD-191: `31261116941125000156550010000030301038050728`
- NF 3024 / TD-194: `31261116941125000156550010000030241038041217`

As TD-184/191/194 continuam sem vínculo direto em devolucao_doc_id, como estavam antes, mas as reversas têm as notas e há uma troca aberta por venda. Nenhum vínculo antigo foi atualizado nesta entrega. A trava continua podendo reconhecer a nota pelo documento referenciado durante a conferência. Os itens ainda não estão conferidos; não foi executada a finalização real.

## Testes e limites da verificação

**25 testes passaram** em devolucaoValues, devolucaoGuard e correiosReverse:

- Oito TDs reproduzidas em dry_run do código real, sem permitir gravações nem chamadas externas.
- Reversa nova simulada: R$ 359,99 − R$ 36,00 = R$ 323,99; permanece elegível para uma emissão futura, não executada.
- Troca e reversa com produtos fiscais idênticos.
- Fallback com valor já líquido não aplica desconto novamente.
- Devolução parcial com desconto proporcional.
- Diagnóstico de desconto ausente somente quando comprovado pelos valores/vínculo.
- Vínculo da nova nota com a única troca aberta: trecho existente de correios-reverse executado apenas contra banco em memória.
- Reuso, divergência e teto da nota original preservados pelos testes existentes da trava.

O deploy foi confirmado pela ferramenta. Não foi invocada a função hospedada em produção, nem com dry_run: os testes do handler ocorreram localmente com as mesmas entradas fiscais lidas por SQL. Não foi feita conferência real na tela, pois ela envolve emissão/finalização; a mensagem é entregue pelo servidor ao aviso já existente.

Nenhuma consulta nova foi acrescentada ao fluxo normal; apenas um índice em memória por ID. Sem polling, cron, migrações ou carga de listas adicionais.

## Preservação

**Nenhuma NF emitida, cancelada, inutilizada ou alterada.** Nenhuma chamada de emissão à SEFAZ/BrasilNFe, nenhuma escrita de dados de negócio no banco e nenhum dado de teste criado ou apagado. Nada publicado no front-end. Planos .lovable/plan*.md e trava de duplicidade não editados. Logs mantidos. A prévia compilou sem erros.