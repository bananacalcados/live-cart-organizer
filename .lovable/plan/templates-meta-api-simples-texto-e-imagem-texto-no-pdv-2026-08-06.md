# Templates Meta API simples (texto e imagem+texto) no PDV

Hoje, em **PDV > Online > Automações > Templates**, só existe o editor de carrossel (Escada). O plano adiciona, na mesma aba, a criação de templates **somente texto** e **imagem + texto**, com variáveis, sem mexer no que já funciona.

## O que já existe (aproveitar, não recriar)

- Já existe um criador de templates Meta completo (texto, imagem, vídeo, documento, botões) usado em outras telas do sistema — ele só nunca foi ligado nessa aba do PDV.
- Já existe o campo de texto com botões de variáveis ({{nome}}, {{primeiro_nome}}, {{tamanho}}, {{vendedora}} e variável livre) usado no carrossel.
- Já existe upload de imagem para a Meta e a função que envia o template para aprovação.

A ideia é juntar essas três peças em vez de escrever tudo do zero.

## Como fica a tela

A aba **Templates** ganha duas sub-abas:

```text
Templates
 ├── Carrossel   (exatamente como é hoje, nada muda)
 └── Simples     (novo: Somente texto | Imagem + texto)
```

Na sub-aba **Simples**:

1. Escolher a instância/número Meta (mesmo seletor do carrossel).
2. Escolher o tipo: **Somente texto** ou **Imagem + texto**.
3. Nome do template e categoria (Marketing / Utilidade).
4. Cabeçalho:
   - Somente texto: opcional, um título curto (com variável se quiser).
   - Imagem + texto: subir a imagem de exemplo (a mesma imagem que a Meta usa para aprovar).
5. Corpo da mensagem com os botões de variáveis e emojis — igual ao carrossel, com prévia embaixo.
6. Rodapé opcional (texto fixo).
7. Botões opcionais (até 2): Resposta rápida, Link (URL) ou Ligar.
8. Botão **Enviar para aprovação** + lista dos templates simples já criados, com status (Aprovado / Pendente / Rejeitado) e botão de atualizar status.

## Regras que garantem que nada quebra

- O editor de carrossel e a tabela dele continuam intactos; o novo fluxo é um componente separado.
- Templates simples não entram na "escada" de carrossel — ficam listados lidos direto da Meta (mesma listagem já usada nos disparos), então eles aparecem automaticamente onde já se escolhe template (chat, disparo em massa, automações) assim que a Meta aprovar.
- Variáveis nomeadas são convertidas para o formato posicional exigido pela Meta ({{1}}, {{2}}...) com os exemplos de aprovação, usando a mesma conversão já validada do carrossel.
- Validações antes de enviar: nome sem espaços/maiúsculas, corpo obrigatório, imagem obrigatória no modo imagem, exemplo preenchido para cada variável, URL/telefone dos botões preenchidos. Isso evita rejeição da Meta.
- Nenhuma alteração em banco de dados, disparos, cotas ou fallback de provedores.

## Detalhes técnicos

- Novo componente `src/components/admin/SimpleTemplatesPanel.tsx`, montado dentro de `POSOnlineHub.tsx` em `<Tabs>` junto com `CarouselTemplatesLadder` (que passa a viver na sub-aba "Carrossel").
- Reuso de `VariableTextField` + `buildComponentText` de `src/lib/pos/carouselTemplate.ts` para variáveis nomeadas → posicionais e exemplos.
- Upload de imagem pela rota de upload resumable já existente (retorna o `header_handle`), e criação via edge function `meta-whatsapp-create-template` (já pronta, sem alteração).
- Listagem/status via `meta-whatsapp-get-templates`, filtrando os que não são carrossel.
- Prefixo de nome opcional (`pdv_`) para organizar, mantendo unicidade na Meta.

## Fora do escopo

- Edição de template já aprovado (a Meta exige recriar em muitos casos).
- Templates de vídeo/documento nesta aba (podem entrar depois, a base já suporta).
