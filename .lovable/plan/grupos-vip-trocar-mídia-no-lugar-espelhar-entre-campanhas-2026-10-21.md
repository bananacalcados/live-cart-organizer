# Grupos VIP — trocar mídia no lugar + espelhar entre campanhas

## 1) Trocar uma imagem já enviada (sem criar bloco novo)

Hoje o editor da mensagem (`ScheduledMessageForm`) só permite **remover** um arquivo e **adicionar** outro — o upload sempre entra como item novo no fim da lista.

**Mudança:** em cada arquivo da lista de mídias do bloco, adicionar um botão **"Trocar"** (ícone de substituir) ao lado do "Remover":
- Abre o seletor de arquivo; ao escolher, sobe o arquivo e **substitui a URL na mesma posição**, mantendo a legenda daquele item.
- Vale para imagem, vídeo, áudio e documento, em rascunhos e mensagens aguardando aprovação.
- Se a nova mídia for de tipo diferente (ex.: trocar foto por vídeo), o tipo do bloco acompanha.

## 2) Espelhar mídia em mensagens idênticas de outras campanhas

**Como identificar "a mesma mensagem" sem risco:** ao salvar uma edição que mexeu em mídia, o sistema procura em **outras campanhas** mensagens **ainda não enviadas** (rascunho/aguardando) que sejam idênticas pela assinatura:
- mesmo tipo de bloco (imagem/vídeo/etc.),
- mesmo texto/legenda (normalizado, ignorando espaços),
- mesma posição do bloco dentro da sequência da mensagem.

Só entra na comparação mensagem com texto idêntico — foto em mensagem com texto diferente **nunca** é tocada.

**Fluxo:**
1. Você salva a edição na campanha A (ex.: Live - Fim de Semana).
2. Se houver mensagem idêntica na campanha B (ex.: Lançamentos e Eventos 72h), aparece uma pergunta: **"Encontrei a mesma mensagem na campanha X. Aplicar a mesma imagem lá também?"** com prévia da foto e do texto.
3. Se confirmar, a imagem é copiada para a mensagem da campanha B (mesma URL, sem upload duplicado). Se recusar, nada acontece na B.
4. O mesmo vale ao **trocar** uma imagem depois: ao salvar, pergunta de novo se quer atualizar na outra campanha.

**Limites de segurança:**
- Só mensagens pendentes/rascunho; mensagem já enviada nunca é alterada.
- Nada é automático sem a sua confirmação na hora.
- A cópia usa a mesma URL já enviada (sem re-upload, sem custo extra de storage).

## Sobre "o Claude esqueceu de subir nos eventos de 72h"

Hoje **nada marca** de qual campanha uma mensagem veio — cada campanha tem sua própria lista de mensagens, independente. O item 2 resolve o trabalho dobrado sem precisar de marcação: a detecção é por conteúdo idêntico na hora de salvar.

## Arquivos tocados

- `src/components/marketing/ScheduledMessageForm.tsx` — botão "Trocar" por item de mídia.
- `src/components/marketing/CampaignDetailPanel.tsx` — após salvar edição com mídia, buscar mensagens idênticas em outras campanhas e mostrar o diálogo de confirmação; aplicar a cópia.
- Teste novo em `src/test/` cobrindo: troca mantém posição e legenda; espelhamento só ocorre com texto idêntico e após confirmação.

## Fora de escopo

- Nada muda no envio, no worker de disparo ou em mensagens já enviadas.
- Sem publicação sem sua autorização.
