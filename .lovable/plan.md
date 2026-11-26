# Estoque no celular — versão separada

## Parte 1 — Auditoria (390x844, toque, admin, sem gravar nada)

Prints: Files > estoque-celular (início, loja escolhida, Balanço, Produtos, Etiquetas, Inventário, Captação).

| Tarefa | Onde é feita hoje | Como fica em 390px | Nota |
|---|---|---|---|
| Contagem de estoque | Estoque > Balanço > Iniciar Balanço > aba Contagem (Inventory.tsx); também "Inventário" (InventoryCycles) | A tela inicial cabe bem e a contagem já tem campo grande e botão de câmera, mas o botão "Balanço" do menu fica fora da tela (ver item 1). A contagem não foi aberta para não criar balanço. São 5 abas (Contagem/Conferência/Pendentes/Revisão/Correção) numa linha só | 2 |
| Etiquetas a partir da contagem | Estoque > Etiquetas e Balanços (LabelBatchesHistory + ProductLabelPrintDialog) | A lista de lotes é legível, mas "Soma das mudanças" quebra a linha. A impressão é feita para impressora de PC | 2 |
| Bipar para localizar | Não há tela própria: é a busca de Produtos (texto) ou o bipe dentro do Balanço | A busca é cortada ("Buscar por nome, parent_sku, SKU, có…"). Não existe câmera nessa busca. Só dá para localizar digitando ou com leitor físico | 1 |
| Subir fotos | Produtos > lápis > Editar produto > Fotos por cor (ProductColorPhotos) | Fica dentro de uma janela grande, de 1.100 linhas de código. Só existe "escolher arquivo", sem botão de câmera | 2 |
| Editar produtos | Produtos > lápis (ProductEditDialog, janela de computador) | Cartões de produto apertados: nome cortado ("PB…"), selos empilhados em colunas estreitas e 259 botões com menos de 32px de altura na lista | 1 |
| Balanços | Igual à contagem (Balanço / Inventário / Balanço multi-loja) | Igual à contagem | 2 |

Câmera hoje: existe leitura de código de barras pela câmera, com a biblioteca html5-qrcode (POSBarcodeScanner). Ela já é usada no Balanço (botão de câmera ao lado do campo), no PDV e na Expedição. A Captação lê código a partir de foto (CapturePhotoScanner). O bipe também funciona com leitor físico, que se comporta como teclado digitando no campo. Não existe tirar foto pela câmera para as fotos do produto.

### Os 10 piores problemas (do mais grave ao menos grave)
1. O menu do Estoque (Balanço, Captação, Produtos, NF-e, Etiquetas, Inventário, Categorias, Códigos, Ações em Massa) fica para a direita, fora da tela. No celular só aparece "Dashboard". As tarefas do dia a dia ficam praticamente inacessíveis.
2. O menu só aparece depois de escolher a loja num seletor pequeno e cortado ("Loja…").
3. A tela abre no Dashboard (números de custo e gráficos), e não no que a equipe usa.
4. O título "Controle de Estoque" quebra em 3 linhas e sai por cima do topo da tela.
5. A página inicial rola para os lados (largura de 419px numa tela de 390px).
6. Na lista de produtos, o nome fica cortado em "PB…" e os selos empilham em colunas estreitas.
7. A lista de produtos tem centenas de botões com menos de 32px (lixeira, etiqueta e lápis colados).
8. A lixeira de excluir produto fica ao lado do lápis de editar: risco de toque errado.
9. Editar produto e Fotos ficam dentro de uma janela de computador muito longa, sem câmera.
10. As abas de cima (Visão Geral/Saúde/Análise…) e as do Balanço (5 abas) não cabem e ficam cortadas. O balão de chat flutuante cobre o canto inferior direito.

Não auditado: a contagem em andamento, a janela de edição aberta e a impressão de etiquetas, porque exigiriam criar balanço ou abrir fluxos que gravam.

## Parte 2 — Proposta

### 1) Arquitetura
- Rota própria `/m/estoque/*`, com telas em `src/mobile/inventory/`. Essas telas reaproveitam somente as funções de dados, RPCs e libs que já existem (bipe do balanço, lotes de etiquetas, fotos, IA). Nenhuma regra de negócio é copiada; onde a regra estiver presa dentro de uma tela de computador, ela é movida para uma lib compartilhada, sem mudar o comportamento.
- Como a pessoa chega lá: ao abrir `/inventory` num aparelho de toque com tela menor que 768px, ela vai automaticamente para `/m/estoque`. Na versão mobile há um link "Ver versão completa", que fica lembrado no aparelho. O desktop não muda: a única alteração nele é esse desvio no início da página.
- Mesma permissão do módulo Estoque.

### 2) Telas (pensadas para uma mão)
- **Início:** loja no topo e 4 botões grandes: Bipar/Buscar, Contagem, Etiquetas, Produtos.
- **Buscar/Bipar:** campo grande com foco automático (funciona com leitor físico) e botão de câmera grande; o resultado abre a ficha.
- **Ficha do produto:** foto, preço, estoque por cor e tamanho em cada loja (lojas recolhíveis), Fotos por cor com "Tirar foto", "Galeria" e "Gerar com IA", e botão "Editar dados".
- **Editar dados (1ª versão):** nome, preço, marca, categoria, ativar ou desativar variação. A grade e as variações novas ficam no computador.
- **Contagem/Balanço:** bipe e quantidade no topo, último item lido grande, totais, desfazer o último bipe, abas Contagem/Pendentes/Revisão em menu de baixo, e finalizar com confirmação dupla.
- **Etiquetas:** lista de lotes da contagem, ver itens e "Imprimir" (o mesmo PDF da impressora de etiquetas).

Primeira versão: Início, Bipar, Ficha (com fotos e IA), Contagem/Balanço da loja.
Depois: Etiquetas, Editar dados, Inventário cíclico.
Fica fora do celular: Dashboard e análises, NF-e de entrada, Ações em massa, Shopify, De-para, Divergências, Categorias/Códigos, Balanço multi-loja e Excluir produto.

### 3) Câmera para foto
- Dois botões: "Tirar foto" (`capture="environment"`, abre a câmera traseira) e "Galeria".
- Antes de enviar, o aparelho reduz a foto para no máximo 2.560px no lado maior e salva como JPEG de qualidade 0,85 (fica entre 1 e 2 MB). Isso acelera o envio no 4G e continua com qualidade boa para a IA.
- HEIC do iPhone: a câmera aberta pelo navegador já entrega JPEG, e na Galeria o Safari converte para JPEG quando o campo aceita só JPG/PNG/WEBP. Na prática, não é preciso habilitar HEIC no serviço. Como proteção, se chegar um HEIC (por exemplo, pelo app Arquivos), aparece "Formato não aceito, use a câmera ou a galeria". Fica a confirmar num iPhone real.

### 4) Código de barras pela câmera
- Usar o BarcodeDetector nativo quando existir (Chrome no Android, rápido e sem custo de download). Quando não existir, usar a html5-qrcode, que já está no projeto (necessária em iPhones e alguns Androids).
- Carregar só nas telas de bipe (sob demanda), sem aumentar o peso das outras telas.
- Limitações: precisa de HTTPS e da permissão de câmera. No iPhone a leitura é mais lenta e o foco em código pequeno é pior. Etiqueta amassada ou com reflexo falha, e aí fica o campo para digitar. Bipe, vibração e um aviso evitam ler o mesmo código duas vezes em sequência.

### 5) Proteção contra regressão
- Testes automáticos em tela de 390x844 para cada tela mobile: sem rolagem para os lados, botões principais visíveis e com 44px ou mais, busca levando à ficha, bipe simulado somando na contagem, botões de foto presentes, e o desvio do /inventory (celular vai para a versão mobile, computador não).
- Regra no AGENTS.md: telas do celular ficam em `src/mobile/`, não importam telas do desktop e não são importadas por elas; só libs e hooks são compartilhados. Mudança de regra vai para a lib, nunca para a tela.

### 6) Fases
| Fase | O que entrega | Tamanho |
|---|---|---|
| 1 | Rota, Início, Bipar/Buscar com câmera e Ficha (somente leitura) + desvio automático e testes | médio |
| 2 | Fotos na ficha: tirar foto, galeria, compressão e Gerar com IA | pequeno |
| 3 | Contagem/Balanço mobile, reaproveitando as funções do balanço | grande |
| 4 | Etiquetas da contagem + Editar dados básicos | médio |

Cada fase pode ser desligada removendo o desvio, e o desktop continua igual.

Riscos: a lógica do balanço está dentro de uma tela de 2.500 linhas, e movê-la para uma lib exige cuidado para não mudar a contagem no desktop (testes antes e depois). Também há o risco de duas pessoas contarem a mesma loja (vale a mesma trava de hoje).

Não vou conseguir testar: câmera real, leitor físico real, iPhone e Android reais, HEIC real e impressão real de etiquetas.

### 7) Perguntas para o Matthews
1. O desvio automático para o celular vale para todo mundo, ou só para quem escolher?
2. As vendedoras sem o módulo Estoque também devem usar o Bipar/Ficha (somente consulta)?
3. A equipe imprime etiqueta pelo celular (impressora Bluetooth/Wi-Fi) ou só gera e imprime no computador?
4. No celular, a ficha deve mostrar custo, ou só preço de venda?
5. Qual é o modelo de celular mais usado na loja (iPhone ou Android, e qual)?
