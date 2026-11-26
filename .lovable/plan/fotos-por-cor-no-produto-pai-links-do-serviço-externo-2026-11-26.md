# Fotos por cor no produto pai (links do serviço externo)

## Resumo
Nova seção "Fotos por cor" na edição do produto do Estoque. A foto vai do navegador direto para fotos.servidorbanana.com; o ERP guarda só os links. Tudo atrás de um interruptor (padrão: só admin). Nada existente muda: campo "Imagens", botão "Salvar Alterações" e tabelas atuais ficam intactos.

## Respostas pedidas

### a) Origens para o CORS
- https://checkout.bananacalcados.com.br (domínio próprio, principal)
- https://live-cart-organizer.lovable.app (publicado)
- https://id-preview--79193b8b-9883-4f3b-a197-18d0ddc1605a.lovable.app (prévia)
- Recomendado também: https://79193b8b-9883-4f3b-a197-18d0ddc1605a.lovableproject.com (prévia dentro do editor)
- Método POST + OPTIONS; cabeçalhos permitidos: Authorization, Content-Type.

### b) Formato real de color_key (consultado agora)
1.143 códigos; 287 NÃO casam com o regex. Exemplos:
- casam: preto (319), marrom, branco, nude, caramelo, dourado, bege, bronze
- não casam: vazio (87), "café" (acento), "branco off" e "off white" (espaço)

Solução: gerar no front um slug a partir do color_key (ou do rótulo da cor quando vazio): minúsculas, sem acento, espaços/símbolos viram "-", corta em 60; vazio vira "sem-cor". Ex.: café -> cafe, branco off -> branco-off, off white -> off-white. Esse slug é o que vai no envio e na coluna color_key da tabela nova; o rótulo original vai em color. Nada é gravado em product_color_codes.

### c) Arquivos
Criados:
- src/lib/productPhotos.ts — URL base, slug da cor, envio/exclusão, mensagens de erro em português
- src/components/inventory/ProductColorPhotos.tsx — a seção
- src/hooks/useProductColorPhotosMode.ts — lê o interruptor
- src/test/productPhotos.test.ts
- migração nova em drizzle/migrations (via ferramenta)
Alterado:
- src/components/inventory/ProductEditDialog.tsx — só 1 import + 1 linha renderizando a seção abaixo de "Dados do Produto" (quando há produto salvo)
- AGENTS.md — 1 regra (fotos em serviço externo, só links no banco)

Migração SQL:
```sql
CREATE TABLE public.product_color_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id uuid NOT NULL REFERENCES public.products_master(id) ON DELETE CASCADE,
  color_key text NOT NULL CHECK (color_key ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  color text,
  photo_id text NOT NULL CHECK (photo_id ~ '^[0-9a-f]{32}$'),
  url_thumb text NOT NULL CHECK (url_thumb LIKE 'https://fotos.servidorbanana.com/%'),
  url_medium text NOT NULL CHECK (url_medium LIKE 'https://fotos.servidorbanana.com/%'),
  url_full text NOT NULL CHECK (url_full LIKE 'https://fotos.servidorbanana.com/%'),
  width int, height int,
  position int NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'upload',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_id, color_key, photo_id)
);
CREATE INDEX idx_product_color_photos_master_color_pos
  ON public.product_color_photos (master_id, color_key, position);

REVOKE ALL ON public.product_color_photos FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_color_photos TO authenticated;
GRANT ALL ON public.product_color_photos TO service_role;
ALTER TABLE public.product_color_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory users view color photos" ON public.product_color_photos
  FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users insert color photos" ON public.product_color_photos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users update color photos" ON public.product_color_photos
  FOR UPDATE TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users delete color photos" ON public.product_color_photos
  FOR DELETE TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.can_upload_product_photos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN false
    ELSE (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin')) END
$$;
REVOKE ALL ON FUNCTION public.can_upload_product_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_product_photos() TO authenticated;
```
(Políticas idênticas às de products_master, conferidas agora. A função só responde sobre o próprio usuário logado, por isso DEFINER é seguro.)

Interruptor: a linha product_color_photos_mode = 'admin' em app_settings é inserida pela ferramenta de dados (não pela migração). Antes, confiro a estrutura e quem lê/escreve app_settings.

### d) Riscos e como "off" desfaz
- Diálogo de edição: única mudança é uma linha; se a seção der erro, fica isolada num limite de erro e o resto do diálogo continua.
- Banco: tabela nova, nenhuma trigger, nenhuma tabela existente tocada; 1 consulta por abertura do diálogo (+1 leitura do interruptor, em cache).
- Foto órfã: se o envio funciona mas gravar o link falha, chamo /api/delete na hora para não sobrar arquivo.
- Excluir: apago no serviço e depois a linha; se o serviço falhar, a linha fica e aviso.
- CORS/servidor fora do ar: só a seção mostra erro; nada mais é afetado.
- Cores sem variação salva (produto novo): seção aparece só depois de salvar.
- "off": o componente retorna nada antes de qualquer consulta; a tela fica exatamente como hoje. Fotos já gravadas continuam no banco, só não aparecem.

Como alterar o interruptor: me peça ("muda fotos por cor para on/off/admin") e eu troco o valor; vale na próxima abertura do diálogo, sem publicar.

### e) Testes
- slug da cor: preto, café, branco off, off white, vazio, 80 caracteres -> sempre casa o regex
- regra do interruptor: off nunca mostra; admin só admin; on quem tem estoque
- validação de arquivo antes do envio: tipo e 15 MB
- tradução de erros 400/401/413/415/422/429
- resposta do serviço: rejeita URL fora de fotos.servidorbanana.com ou id inválido
- reordenação recalcula position 0..n
- SQL: anon sem acesso; usuário sem estoque não lê/grava; função devolve false sem login

## Detalhes da seção (UI)
- Um bloco por cor distinta das variações salvas do produto (cor da variação + código de cor daquele produto).
- Miniaturas 96x96 fixas, lazy; clique abre a média; botão baixar a full.
- Enviar várias (JPG/PNG/WEBP), no máx. 3 ao mesmo tempo, barra por arquivo.
- Arrastar para reordenar grava position na hora; excluir pede confirmação.
- Tudo grava na hora com aviso; não depende do "Salvar Alterações".
- Envio: fetch direto com o token da sessão, corpo = arquivo cru.

## Não será feito
Sem proxy de arquivo, sem segredo novo, sem uso do armazenamento do Lovable, sem mexer em "Imagens", handleSave, listas, Shopify ou PDV. Sem publicar.
