# Gerar fotos com IA em "Fotos por cor"

O Matthews monta a foto (modelo, pose, fundo, estilo, formato) numa janela, o serviço de fotos dele gera, e as fotos prontas entram no bloco da cor com um selo "IA". A chave da IA continua só no serviço dele. Não haverá segredo novo, função nova no servidor nem uso de armazenamento.

## Aviso: consulta a cada 4 segundos

As regras de desempenho do projeto proíbem consultas repetidas com intervalo menor que 30 segundos. Aqui isso não pesa no banco, porque a consulta a cada 4 segundos vai só ao serviço de fotos.
- Ela só roda enquanto existe uma geração em andamento.
- Pausa quando a aba fica escondida.
- Para em "concluído", em "falhou" ou depois de 15 minutos.

Peço o ok do Matthews para essa exceção.

## Como fica a tela

**A) Botão "Gerar com IA"** (ícone de brilho)
- Fica ao lado do "+" de cada bloco, inclusive "Geral".
- Só aparece se o bloco tiver pelo menos 1 foto e se a pessoa puder enviar fotos, pela mesma regra do envio (`can_upload_product_photos`).
- Com o interruptor das fotos em "off", a seção inteira continua escondida, como hoje.

**B) Janela "Gerar com IA"** (rola no celular; rodapé fixo)
1. **Foto de origem:** miniaturas do bloco; a primeira já vem marcada.
2. **Modo:** Fotos avulsas (1 a 4) ou Ensaio de 4 fotos.
3. **Modelo:** Sem modelo, Automático ou Escolher. "Escolher" abre uma grade com filtro por gênero e busca por nome.
4. **Pose:** só aparece com modelo e no modo avulsas. Grade com opção "Nenhuma"; as distâncias da pose limitam a distância da câmera.
5. **Fundo:** Automático, Transparente, Cor (seletor) ou Cenário salvo (grade).
6. **Estilo de fotografia:** grade com busca e "Nenhum". Mostra 24 por vez com "mostrar mais", e as miniaturas carregam aos poucos.
7. **Formato:**
   - proporção: 1:1, 4:5, 3:4, 9:16 e 16:9 em destaque; as demais em "mais";
   - resolução: 1K, 2K ou 4K;
   - quantidade de fotos (só avulsas).
8. **Avançado** (fechado): enquadramento, sombra e distância da câmera, com rótulos em português. Só no modo avulsas.
9. **Orientações:** texto livre, até 2000 caracteres.
10. **Kits:** escolher e aplicar um kit, "Salvar como kit" e excluir.
11. **Rodapé:** custo estimado, saldo, uso do dia (ex.: 12/40) e o botão "Gerar".

**O que fica bloqueado sozinho:**
- No ensaio somem pose, distância e 4K, e a quantidade vira 4.
- Com "Sem modelo" some a pose.
- Se o custo passar do que sobra no dia, "Gerar" fica desligado e aparece o aviso "limite do dia".

**Custo estimado no navegador:** avulsas = quantidade × (1 em 1K/2K, 2 em 4K); ensaio = 2. O número que vale é o `custo_estimado` que o serviço devolve, e é ele que aparece depois de enviar.

**C) Kits** (compartilhados pela equipe)
- Tabela nova pequena: nome, opções escolhidas (só ids e escolhas, nenhum dado da IA), quem criou e quando.
- Mesma regra de acesso das fotos: ler, criar e excluir só com o módulo Estoque ou admin.
- Ao aplicar um kit, se algum id não existir mais na biblioteca, essa opção volta para o padrão e aparece um aviso.
- O kit não guarda a foto de origem.

**D) Durante a geração**
- A janela fecha logo depois de "Gerar".
- No bloco aparece um cartão "gerando…" com a etapa: na fila, enviando, gerando.
- Ao concluir, cada foto é salva no fim do bloco, com origem "ia" e um selo "IA" na miniatura.
- Se não der para salvar uma foto, ela é apagada do serviço.
  - Exceção: se o erro for "essa foto já está salva", não apaga, porque outra aba já salvou.
- Saindo da página antes de terminar, a geração não se perde:
  - O número da geração fica guardado no navegador, por usuária, com produto, cor e horário.
  - Ao reabrir esse produto, o sistema consulta de novo e salva as fotos já prontas.
  - Depois de salvar ou falhar, ou depois de 24 horas, o registro é apagado.
  - Limite: se a pessoa trocar de computador, a geração pendente só é recuperada no computador onde foi iniciada.

**E) Fica igual:** envio, reordenação, exclusão, download, PDV e lista Legacy.

## Duplo clique e duplicidade

- "Gerar" trava assim que é clicado. Uma segunda trava interna ignora qualquer clique enquanto o primeiro envio não responde, e o botão só volta depois da resposta ou do erro.
- O bloco aceita uma geração por vez. Enquanto houver uma pendente, o botão do bloco mostra "gerando…".
- Salvar foto pronta não duplica: a tabela já recusa a mesma foto duas vezes no mesmo produto e cor, e o salvamento ignora a repetida. Duas abas abertas não geram cópia.

## Erros e limites (mensagens simples)

- **400 opção inválida:** "Opção inválida: <campo em português>", com o campo destacado na janela.
- **401:** "Sessão expirada, entre de novo."
- **404:** "A foto de origem não existe mais no serviço."
- **429 limite do dia:** "Limite diário de créditos atingido (40). Volta amanhã." "Gerar" fica desligado. Não tenta de novo sozinho.
- **429 muitas ao mesmo tempo:** "Já tem geração rodando, espere terminar." Não tenta de novo sozinho.
- **503:** "IA não configurada no serviço de fotos."
- **Falha de rede ao enviar:** avisa e não repete sozinho, porque repetir pode gastar crédito duas vezes.
- **Falha de rede ao consultar:** continua tentando no mesmo ritmo até o teto de 15 minutos. Passado o teto, o cartão vira "não terminou; reabra o produto mais tarde" e o registro fica guardado.
- **Geração falhou:** cartão vermelho com o erro do serviço e "X de Y fotos falharam". As que deram certo são salvas mesmo assim.

## Riscos de regressão

- **Seção de fotos:** só ganha um botão e um cartão. Envio, ordem e exclusão não mudam; o salvamento da IA usa o mesmo salvamento do envio, mudando só a origem.
- **Biblioteca da IA:** só é buscada quando a janela abre, e fica guardada por 10 minutos. Nada carrega ao abrir o produto.
- **Erro na janela:** fica preso a ela e não derruba a ficha do produto.
- **Fotos de IA no PDV e no Legacy:** aparecem como qualquer outra foto daquela cor. Se a IA for posta num bloco de cor, ela pode virar a foto principal se for arrastada para a primeira posição. Isso é esperado.

## Testes

Simulados, sem gerar imagem de verdade:
- Montagem do pedido para o serviço, em cada combinação: sem modelo/automático/escolhido, avulsas/ensaio, tipos de fundo, campos que somem no ensaio.
- Custo estimado: 1K/2K/4K, 1 a 4 fotos e ensaio = 2.
- Bloqueios das opções incompatíveis.
- Leitura do retorno do serviço (aceita só links das fotos) e tradução de cada erro em mensagem.
- Consulta repetida com respostas simuladas: fila → gerando → concluído com 2 fotos e 1 falha. Confere que salva 2, que para ao concluir e que pausa com a aba escondida.
- Recuperação: pendência guardada → ao reabrir salva as fotos e limpa o registro; pendência de mais de 24 horas é descartada.
- Duplo clique envia só uma vez; foto repetida não apaga nem duplica.
- No banco, com tudo desfeito no final: Estoque cria e exclui kit; vendedora só com PDV não lê kit; visitante não acessa.
- No navegador como admin: abrir a janela com a biblioteca simulada, montar opções e ver custo e bloqueios. Não clico em "Gerar" de verdade.

Não vou conseguir testar:
- Uma geração real ponta a ponta (gastaria crédito).
- O tempo real da geração.
- A biblioteca real carregando as 333 miniaturas, a não ser que o Matthews libere uma leitura da biblioteca, que não gasta crédito.

## Detalhes técnicos

Criados:
- `src/lib/productPhotosAi.ts`: tipos, montagem/validação das opções, custo, rótulos em português, leitura das respostas, chamadas library/generate/job com o token da sessão.
- `src/lib/productPhotosAiPending.ts`: registro das gerações pendentes no navegador, por usuária e produto, com validade de 24 horas.
- `src/hooks/useAiPhotoJobs.ts`: consulta a cada 4 segundos com pausa quando a aba está escondida, teto de 15 minutos, salvamento ignorando repetidas, reconciliação ao abrir.
- `src/components/inventory/AiPhotoDialog.tsx` (janela) e `src/components/inventory/AiPhotoPicker.tsx` (grade com busca e "mostrar mais").
- Testes em `src/test/productPhotosAi.test.ts` e `src/test/productPhotosAiPending.test.ts`.

Alterados:
- `src/components/inventory/ProductColorPhotos.tsx`: botão, cartão de progresso, selo "IA" (incluir `source` na leitura das fotos).
- `src/components/inventory/AGENTS.md`: uma regra sobre a IA passar só pelo serviço de fotos.

Migração: tabela `product_photo_ai_presets`
- colunas: id, name (único, até 60), options jsonb, created_by, created_at;
- regra de acesso com `has_module_access('inventory')` ou admin para ler, criar e excluir;
- permissões para authenticated e service_role; nada para visitante.

Não publico. Haverá mudança de front.
