// Tool definitions for the Ads AI agent (Jess) — tool calling
export const adsTools = [
  {
    type: "function",
    function: {
      name: "search_product",
      description: "Buscar produto na loja por nome, cor, tipo, tamanho, descrição ou CARACTERÍSTICA VISUAL. Use quando o cliente perguntar sobre detalhes do produto (tamanhos, cores, preço). Use TAMBÉM quando quiser explorar opções (ex: 'quero ver tênis', 'tênis casual'). Agora também aceita buscas por características visuais como 'solado baixo', 'chunky', 'plataforma', 'minimalista', 'salto alto', etc. — o sistema tem tags visuais pré-analisadas por IA das fotos dos produtos. DICA: use termos simples.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca: nome, cor, tipo do produto" },
          visual_tags: { type: "array", items: { type: "string" }, description: "Tags visuais para filtrar (ex: ['solado_baixo', 'casual']). Tags disponíveis: solado_baixo, solado_alto, chunky, plataforma, bico_fino, bico_redondo, bico_quadrado, minimalista, casual, esportivo, social, elegante, salto_alto, salto_baixo, rasteira, sem_salto, tira, fivela, cadarco, slip_on, velcro, couro, sintetico, tecido, camurca, aberto, fechado, meia_pata, ortopedico, conforto, anatomico, leve, robusto, delicado, cores_neutras, cores_vibrantes, estampado, metalizado" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_lead_data",
      description: "Salvar dados extraídos do lead (nome, cidade, tamanho, CPF, email, endereço). Chame sempre que extrair qualquer dado da conversa.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome completo do cliente" },
          tamanho: { type: "string", description: "Tamanho/número do calçado" },
          cor: { type: "string", description: "Cor do produto desejada pelo cliente" },
          cidade: { type: "string", description: "Cidade do cliente" },
          estado: { type: "string", description: "Estado (UF)" },
          cpf: { type: "string", description: "CPF do cliente" },
          email: { type: "string", description: "E-mail do cliente" },
          cep: { type: "string", description: "CEP do endereço" },
          endereco: { type: "string", description: "Endereço completo" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_checkout_link",
      description: "Gerar link do checkout transparente para o cliente finalizar a compra. O checkout aceita PIX (com desconto automático) e cartão de crédito. IMPORTANTE: Antes de chamar esta ferramenta, você DEVE ter coletado o tamanho E a cor desejada do produto. Se faltar algum desses dados, pergunte ao cliente antes de gerar o link.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Nome do produto" },
          amount: { type: "number", description: "Valor unitário em reais" },
          quantity: { type: "number", description: "Quantidade do produto (padrão: 1)" },
          variant: { type: "string", description: "Variante/tamanho do produto (ex: '38')" },
          color: { type: "string", description: "Cor do produto escolhida pelo cliente (ex: 'Preto', 'Rosa')" },
        },
        required: ["product_name", "amount", "variant", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_delivery_payment",
      description: "Confirmar pagamento na entrega (somente para clientes de Governador Valadares). Registra o pedido para entrega local.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Nome do produto" },
          amount: { type: "number", description: "Valor total em reais" },
        },
        required: ["product_name", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_cep",
      description: "Consultar CEP para obter endereço completo. Use quando o cliente informar um CEP.",
      parameters: {
        type: "object",
        properties: {
          cep: { type: "string", description: "CEP com 8 dígitos" },
        },
        required: ["cep"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_live_reminder",
      description: "Registrar que o cliente quer ser lembrado quando a live começar. Use quando o cliente aceitar o convite da live.",
      parameters: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "Se o cliente confirmou que quer ser lembrado" },
        },
        required: ["confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_product_image",
      description: "Enviar foto do produto para o cliente via WhatsApp. Use quando o cliente pedir para ver fotos, ou após apresentar o produto para reforçar visualmente. Busca a imagem diretamente da Shopify. IMPORTANTE: No campo 'query', use termos CURTOS e SIMPLES que correspondam ao nome real do produto na loja (ex: 'jess', 'melim', 'debora', 'papete'). NÃO invente nomes — use o nome que apareceu na busca anterior (search_product). Se o cliente pedir uma cor específica, envie essa cor. Se o cliente NÃO especificar a cor, esta ferramenta deve enviar automaticamente uma foto de CADA cor disponível do produto.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nome CURTO do produto conforme aparece na Shopify (ex: 'jess', 'melim', 'valentina'). Use o nome retornado por search_product, NÃO invente nomes." },
          color: { type: "string", description: "Cor específica da variante desejada (ex: 'Preto', 'Verde Militar'). Se informada, busca a imagem da variante dessa cor." },
          caption: { type: "string", description: "Legenda curta para acompanhar a foto (ex: 'Tênis Jess Ortopédico - Preto 😍')" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_followup",
      description: "Agendar um follow-up para uma data/hora específica. Use quando o cliente disser que quer ser contatado em um dia/horário específico (ex: 'me manda msg quinta', 'cartão vira dia 15', 'fala comigo amanhã de tarde'). Também use quando o cliente disser 'vou pensar' ou 'vou falar com alguém' sem informar horário — nesse caso agende para o próximo dia útil às 9h.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato YYYY-MM-DD. Se o cliente disser 'amanhã', calcule. Se disser 'quinta', calcule a próxima quinta." },
          time: { type: "string", description: "Horário no formato HH:MM (24h). Default: 09:00" },
          reason: { type: "string", description: "Motivo do agendamento (ex: 'cartão vira', 'vai falar com marido', 'pediu pra ligar quinta')" },
          situation_hint: { type: "string", description: "Tipo de objeção: 'objecao_financeira', 'objecao_consulta', 'objecao_pensar', 'objecao_recusa'" },
        },
        required: ["date", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_support_ticket",
      description: "Abrir um chamado de suporte para as vendedoras humanas responderem. Use SEMPRE que o cliente fizer uma pergunta sobre o produto que você NÃO sabe a resposta (material, composição, detalhes técnicos, caimento, etc). Nunca invente informações sobre o produto — abra o chamado e informe que vai verificar.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "A pergunta do cliente que precisa ser respondida por uma vendedora" },
          context: { type: "string", description: "Contexto adicional (produto em questão, cor, tamanho, etc)" },
        },
        required: ["question"],
      },
    },
  },
];

const PRODUCT_TYPE_KEYWORDS = ['tenis', 'mocassim', 'sandalia', 'papete', 'tamanco', 'sapato', 'bota', 'chinelo'];
const SEARCH_STOP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'por', 'no', 'na', 'o', 'a']);

function normalizeShopifyText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildShopifySearchQueries(query: string): string[] {
  const original = (query || '').trim();
  const normalized = normalizeShopifyText(original);
  const strippedOriginal = original.replace(/\bt[eê]nis\b/gi, '').trim();
  const strippedNormalized = normalized.replace(/\btenis\b/g, '').trim();

  // Split into individual meaningful tokens for fallback searches
  const tokens = normalized.split(' ').filter((t) => t.length > 2 && !SEARCH_STOP_WORDS.has(t));
  
  // Build progressive search queries: full phrase first, then individual tokens
  const queries = [
    original,
    normalized,
    strippedOriginal,
    strippedNormalized,
  ];
  
  // Add individual token searches as fallback (e.g. "jess" alone, "ortopedico" alone)
  // This handles cases where the AI invents product names that don't match Shopify titles
  for (const token of tokens) {
    if (token !== normalized && token !== strippedNormalized) {
      queries.push(token);
    }
  }
  
  return Array.from(new Set(queries.filter(Boolean)));
}

function getVariantColorLabel(variant: any): string {
  const selectedColor = variant?.selectedOptions?.find((o: any) => {
    const name = normalizeShopifyText(o?.name);
    return name === 'cor' || name === 'color';
  })?.value;

  if (selectedColor) return selectedColor;

  const titleParts = String(variant?.title || '').split('/').map((part) => part.trim()).filter(Boolean);
  return titleParts.length > 1 ? titleParts[titleParts.length - 1] : '';
}

function collectProductImageCandidates(product: any): Array<{ url: string; color: string | null; altText: string | null; source: 'variant' | 'product'; }> {
  const seen = new Set<string>();
  const candidates: Array<{ url: string; color: string | null; altText: string | null; source: 'variant' | 'product'; }> = [];

  for (const { node: variant } of product?.variants?.edges || []) {
    const url = variant?.image?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      url,
      color: getVariantColorLabel(variant) || null,
      altText: null,
      source: 'variant',
    });
  }

  for (const { node: image } of product?.images?.edges || []) {
    const url = image?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      url,
      color: image?.altText || null,
      altText: image?.altText || null,
      source: 'product',
    });
  }

  return candidates;
}

function scoreShopifyProduct(product: any, query: string, color?: string): number {
  const title = normalizeShopifyText(product?.title);
  const queryNorm = normalizeShopifyText(query);
  const queryTokens = queryNorm.split(' ').filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
  const candidates = collectProductImageCandidates(product);

  let score = 0;

  if (title === queryNorm) score += 120;
  if (queryNorm && title.includes(queryNorm)) score += 90;

  const matchedTokens = queryTokens.filter((token) => title.includes(token));
  score += matchedTokens.length * 20;
  if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) score += 30;

  const requestedTypes = queryTokens.filter((token) => PRODUCT_TYPE_KEYWORDS.includes(token));
  if (requestedTypes.length > 0) {
    if (requestedTypes.some((token) => title.includes(token))) score += 30;
    else score -= 40;
  }

  if (candidates.length > 0) score += 40;
  else score -= 60;

  if (color) {
    const colorNorm = normalizeShopifyText(color);
    const hasColorMatch = candidates.some((candidate) => {
      const candidateColor = normalizeShopifyText(candidate.color);
      return candidateColor && (candidateColor.includes(colorNorm) || colorNorm.includes(candidateColor));
    });
    if (hasColorMatch) score += 35;
  }

  return score;
}

interface AdsToolContext {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  phone: string;
  leadId: string;
  lead: any;
  campaign: any;
  collectedData: Record<string, any>;
  whatsappNumberId?: string | null;
  channel?: string;
}

async function createAiAssistanceRequest(
  ctx: AdsToolContext,
  payload: {
    requestType: 'product_photo' | 'takeover_chat' | 'technical_info' | 'verify_stock';
    summary: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    productTitle?: string | null;
    shopifyProductId?: string | null;
  },
) {
  const { supabase, phone, collectedData, lead, whatsappNumberId } = ctx;

  try {
    await supabase.from('ai_assistance_requests').insert({
      request_type: payload.requestType,
      status: 'pending',
      customer_phone: phone,
      customer_name: collectedData.nome || lead?.name || null,
      product_title: payload.productTitle || null,
      shopify_product_id: payload.shopifyProductId || null,
      ai_agent: 'jess',
      ai_summary: payload.summary,
      priority: payload.priority || 'normal',
      whatsapp_number_id: whatsappNumberId || lead?.whatsapp_number_id || null,
      store_id: null,
    });
  } catch (error) {
    console.error('[ads-tools] ai assistance request error:', error);
  }
}

export async function executeAdsToolCall(
  toolName: string,
  args: Record<string, any>,
  ctx: AdsToolContext,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { supabase, supabaseUrl, supabaseKey, phone, leadId, lead, campaign, collectedData } = ctx;

  switch (toolName) {
    // ─── SEARCH PRODUCT ───
    case 'search_product': {
      const query = args.query;
      const visualTagsFilter: string[] = args.visual_tags || [];
      const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
      const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

      // ─── Visual tags search: if tags provided, search by visual tags first ───
      if (visualTagsFilter.length > 0) {
        try {
          // Find products matching ALL requested visual tags
          const { data: taggedProducts } = await supabase
            .from('product_visual_tags')
            .select('shopify_product_id, product_title, visual_tags, ai_description')
            .contains('visual_tags', visualTagsFilter);

          if (taggedProducts && taggedProducts.length > 0) {
            // If we also have a text query, filter by it
            const queryNorm = query ? query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
            let filtered = taggedProducts;
            if (queryNorm && queryNorm.length > 2) {
              filtered = taggedProducts.filter((p: any) => {
                const titleNorm = (p.product_title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return titleNorm.includes(queryNorm) || queryNorm.split(' ').some((t: string) => t.length > 2 && titleNorm.includes(t));
              });
              if (filtered.length === 0) filtered = taggedProducts; // fallback to all tag matches
            }

            // Fetch full product details from Shopify for the matched products
            const productIds = filtered.slice(0, 5).map((p: any) => p.shopify_product_id);
            const shopifyProducts: any[] = [];

            if (shopifyDomain && shopifyToken) {
              for (const pid of productIds) {
                const gql = `{
                  node(id: "${pid}") {
                    ... on Product {
                      id title description
                      variants(first: 20) { edges { node { id title price sku availableForSale } } }
                      images(first: 1) { edges { node { url } } }
                    }
                  }
                }`;
                const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
                  method: 'POST',
                  headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ query: gql }),
                });
                const d = await resp.json();
                const node = d?.data?.node;
                if (node?.title) shopifyProducts.push(node);
              }
            }

            const products = shopifyProducts.length > 0
              ? shopifyProducts.map((node: any) => {
                  const tagInfo = filtered.find((t: any) => t.shopify_product_id === node.id);
                  return {
                    title: node.title,
                    description: (node.description || '').substring(0, 500),
                    visual_description: tagInfo?.ai_description || '',
                    visual_tags: tagInfo?.visual_tags || [],
                    image: node.images?.edges?.[0]?.node?.url || null,
                    variants: (node.variants?.edges || []).map((v: any) => ({
                      title: v.node.title, price: v.node.price, sku: v.node.sku, available: v.node.availableForSale,
                    })),
                    available_sizes: (node.variants?.edges || [])
                      .filter((v: any) => v.node.availableForSale)
                      .map((v: any) => v.node.title),
                  };
                })
              : filtered.slice(0, 5).map((p: any) => ({
                  title: p.product_title,
                  visual_description: p.ai_description,
                  visual_tags: p.visual_tags,
                }));

            return {
              success: true,
              data: {
                source: 'visual_tags',
                results: products,
                count: products.length,
                matched_tags: visualTagsFilter,
                message: `Encontrei ${products.length} produto(s) com as características: ${visualTagsFilter.join(', ')}`,
              },
            };
          }
        } catch (tagErr) {
          console.error('[search_product] Visual tags search error:', tagErr);
          // Fall through to regular Shopify search
        }
      }

      if (!shopifyDomain || !shopifyToken) {
        // Fallback: use catalog info from campaign
        const catalog = campaign.product_info?.catalogo || [];
        const results = catalog.filter((p: any) => {
          const searchLower = query.toLowerCase();
          return (p.nome || '').toLowerCase().includes(searchLower) ||
            (p.keywords || []).some((kw: string) => searchLower.includes(kw.toLowerCase()));
        });
        return {
          success: true,
          data: {
            source: 'catalog',
            results: results.length > 0 ? results : catalog,
            message: results.length > 0
              ? `Encontrei ${results.length} produto(s) no catálogo`
              : 'Mostrando todos os produtos do catálogo',
          },
        };
      }

      try {
        const searchQueries = buildShopifySearchQueries(query);
        const allProducts = new Map<string, any>();
        
        for (const sq of searchQueries) {
          const graphql = `{
            products(first: 5, query: "${sq.replace(/"/g, '\\"')}") {
              edges {
                node {
                  id
                  title
                  description
                  variants(first: 20) {
                    edges {
                      node {
                        id
                        title
                        price
                        sku
                        availableForSale
                      }
                    }
                  }
                  images(first: 1) {
                    edges { node { url } }
                  }
                }
              }
            }
          }`;

          const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: graphql }),
          });

          const data = await resp.json();
          for (const edge of (data?.data?.products?.edges || [])) {
            if (!allProducts.has(edge.node.id)) {
              allProducts.set(edge.node.id, edge.node);
            }
          }
          // Stop searching if we found results
          if (allProducts.size > 0) break;
        }

        // Enrich results with visual tags if available
        const productIds = Array.from(allProducts.keys());
        let visualTagsMap = new Map<string, any>();
        if (productIds.length > 0) {
          const { data: tags } = await supabase
            .from('product_visual_tags')
            .select('shopify_product_id, visual_tags, ai_description')
            .in('shopify_product_id', productIds);
          for (const t of tags || []) {
            visualTagsMap.set(t.shopify_product_id, t);
          }
        }

        const products = Array.from(allProducts.values()).slice(0, 5).map((node: any) => {
          const tagInfo = visualTagsMap.get(node.id);
          return {
            title: node.title,
            description: (node.description || '').substring(0, 1000),
            visual_description: tagInfo?.ai_description || undefined,
            visual_tags: tagInfo?.visual_tags || undefined,
            image: node.images?.edges?.[0]?.node?.url || null,
            variants: (node.variants?.edges || []).map((v: any) => ({
              title: v.node.title,
              price: v.node.price,
              sku: v.node.sku,
              available: v.node.availableForSale,
            })),
            available_sizes: (node.variants?.edges || [])
              .filter((v: any) => v.node.availableForSale)
              .map((v: any) => v.node.title),
          };
        });

        return {
          success: true,
          data: {
            source: 'shopify',
            results: products,
            count: products.length,
            message: products.length > 0
              ? `Encontrei ${products.length} produto(s). Tamanhos disponíveis: ${products[0]?.available_sizes?.join(', ') || 'verificar'}`
              : `Nenhum produto encontrado para "${query}"`,
          },
        };
      } catch (err) {
        console.error('[search_product] Error:', err);
        return { success: false, error: 'Erro ao buscar produtos' };
      }
    }

    // ─── SAVE LEAD DATA ───
    case 'save_lead_data': {
      const fields = ['nome', 'tamanho', 'cor', 'cidade', 'estado', 'cpf', 'email', 'cep', 'endereco'];
      const newData: Record<string, any> = { ...collectedData };
      const savedFields: string[] = [];

      for (const f of fields) {
        if (args[f] && String(args[f]).trim()) {
          newData[f] = args[f];
          savedFields.push(f);
        }
      }

      const updates: Record<string, any> = {
        collected_data: newData,
      };
      if (args.nome) updates.name = args.nome;

      // Detect GV for delivery options
      const city = (newData.cidade || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const isGV = city.includes('valadares') || city.includes('gv');

      await supabase.from('ad_leads').update(updates).eq('id', leadId);

      return {
        success: true,
        data: {
          saved_fields: savedFields,
          is_from_gv: isGV,
          all_collected: newData,
          message: `Dados salvos: ${savedFields.join(', ')}`,
        },
      };
    }

    // ─── GENERATE CHECKOUT LINK ───
    case 'generate_checkout_link': {
      const CHECKOUT_BASE_URL = 'https://checkout.bananacalcados.com.br';

      try {
        // 1. Find or create customer
        const phoneDigits = phone.replace(/\D/g, '');
        // Remove DDI 55 for checkout display (expects DDD+number)
        const phoneLocal = phoneDigits.startsWith('55') && phoneDigits.length >= 12
          ? phoneDigits.slice(2)
          : phoneDigits;
        let customerId: string | null = null;

        // Search by phone (last 8 digits)
        const { data: existingCustomers } = await supabase
          .from('customers')
          .select('id')
          .ilike('whatsapp', `%${phoneDigits.slice(-8)}%`)
          .limit(1);

        if (existingCustomers && existingCustomers.length > 0) {
          customerId = existingCustomers[0].id;
        } else {
          // Create customer
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              whatsapp: phoneDigits,
              instagram_handle: collectedData.nome || 'Lead Campanha',
              tags: ['ads-lead'],
            })
            .select('id')
            .single();
          customerId = newCustomer?.id || null;
        }

        if (!customerId) {
          return { success: false, error: 'Não foi possível criar o cadastro do cliente' };
        }

        // 2. Determine event_id from campaign
        const eventId = campaign.event_id;

        // 3. Build product entry
        const quantity = args.quantity || 1;
        const variantLabel = args.variant || collectedData.tamanho || '';
        const colorLabel = args.color || collectedData.cor || '';
        const product = {
          title: args.product_name,
          price: args.amount,
          quantity,
          variant: [variantLabel, colorLabel].filter(Boolean).join(' / '),
          size: variantLabel,
          color: colorLabel,
        };

        // 4. Determine shipping
        const shippingRule = campaign.shipping_rule;
        let freeShipping = false;
        let shippingCost = 0;
        if (shippingRule?.type === 'free') {
          freeShipping = true;
        } else if (shippingRule?.type === 'fixed') {
          shippingCost = Number(shippingRule.value) || 0;
        }

        // 5. Create order
        const orderPayload: Record<string, any> = {
          customer_id: customerId,
          products: [product],
          stage: 'new',
          free_shipping: freeShipping,
          shipping_cost: shippingCost,
          delivery_method: 'shipping',
        };
        if (eventId) orderPayload.event_id = eventId;

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert(orderPayload)
          .select('id')
          .single();

        if (orderErr || !order) {
          console.error('[generate_checkout_link] Order creation error:', orderErr);
          return { success: false, error: 'Erro ao criar pedido para checkout' };
        }

        // 6. Save customer registration data for checkout
        const regData: any = {
          order_id: order.id,
          full_name: collectedData.nome || '',
          whatsapp: phoneLocal,
          cpf: collectedData.cpf || '',
          email: collectedData.email || '',
          cep: collectedData.cep || '',
          address: collectedData.endereco || '',
          address_number: collectedData.numero || '',
          neighborhood: collectedData.bairro || '',
          city: collectedData.cidade || '',
          state: collectedData.estado || '',
        };

        await supabase.from('customer_registrations').upsert(regData, { onConflict: 'order_id' });

        const checkoutUrl = `${CHECKOUT_BASE_URL}/checkout/order/${order.id}`;

        // 7. Update lead
        await supabase.from('ad_leads').update({
          payment_link_sent: true,
          collected_data: { ...collectedData, checkout_url: checkoutUrl, order_id: order.id },
        }).eq('id', leadId);

        // 8. Update order with cart link
        await supabase.from('orders').update({ cart_link: checkoutUrl }).eq('id', order.id);

        // 9. Create follow-up records so cron sends payment reminders
        const phoneForFollowup = phone.replace(/\D/g, '');
        try {
          // Insert chat_awaiting_payment (required for followup cron to send)
          await supabase.from('chat_awaiting_payment').upsert(
            { phone: phoneForFollowup, type: 'ads_checkout', sale_id: null },
            { onConflict: 'phone' }
          );

          // Insert chat_payment_followups with escalating intervals
          const firstReminder = new Date();
          firstReminder.setMinutes(firstReminder.getMinutes() + 5);

          await supabase.from('chat_payment_followups').insert({
            phone: phoneForFollowup,
            type: 'ads_checkout',
            sale_id: null,
            seller_id: null,
            whatsapp_number_id: ctx.whatsappNumberId || null,
            interval_minutes: 30,
            max_reminders: 3,
            reminder_count: 0,
            next_reminder_at: firstReminder.toISOString(),
            is_active: true,
          });
          console.log(`[generate_checkout_link] Follow-up created for ${phoneForFollowup}`);
        } catch (fuErr) {
          console.warn('[generate_checkout_link] Follow-up creation error (non-blocking):', fuErr);
        }

        const total = args.amount * quantity;
        return {
          success: true,
          data: {
            checkout_url: checkoutUrl,
            order_id: order.id,
            amount: total,
            message: `Link de checkout gerado: ${checkoutUrl} — O cliente pode escolher entre PIX (com 5% de desconto) ou cartão de crédito (até 6x sem juros).`,
          },
        };
      } catch (err) {
        console.error('[generate_checkout_link] Error:', err);
        return { success: false, error: 'Erro técnico ao gerar link de checkout' };
      }
    }

    // ─── CONFIRM DELIVERY PAYMENT ───
    case 'confirm_delivery_payment': {
      await supabase.from('ad_leads').update({
        payment_link_sent: true,
        collected_data: { ...collectedData, payment_method: 'entrega', delivery_amount: args.amount },
        temperature: 'convertido',
      }).eq('id', leadId);

      return {
        success: true,
        data: {
          payment_method: 'entrega',
          amount: args.amount,
          message: `Pagamento na entrega confirmado! Valor: R$ ${args.amount.toFixed(2)}. Produto: ${args.product_name}`,
        },
      };
    }

    // ─── LOOKUP CEP ───
    case 'lookup_cep': {
      const cep = (args.cep || '').replace(/\D/g, '');
      if (cep.length !== 8) {
        return { success: false, error: 'CEP inválido. Deve ter 8 dígitos.' };
      }

      try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await resp.json();

        if (data.erro) {
          return { success: false, error: 'CEP não encontrado.' };
        }

        // Auto-save address data
        const newData = {
          ...collectedData,
          cep,
          endereco: `${data.logradouro || ''}, ${data.bairro || ''} - ${data.localidade || ''}/${data.uf || ''}`,
          cidade: data.localidade || '',
          estado: data.uf || '',
        };

        await supabase.from('ad_leads').update({
          collected_data: newData,
        }).eq('id', leadId);

        return {
          success: true,
          data: {
            cep,
            logradouro: data.logradouro || '',
            bairro: data.bairro || '',
            cidade: data.localidade || '',
            estado: data.uf || '',
            message: `Endereço: ${data.logradouro}, ${data.bairro} - ${data.localidade}/${data.uf}. Qual o número?`,
          },
        };
      } catch (e) {
        return { success: false, error: 'Erro ao consultar CEP' };
      }
    }

    // ─── REGISTER LIVE REMINDER ───
    case 'register_live_reminder': {
      if (args.confirmed) {
        await supabase.from('ad_leads').update({
          live_invite_sent: true,
          collected_data: { ...collectedData, live_reminder: true },
        }).eq('id', leadId);

        // Add tag to CRM if exists
        const { data: customers } = await supabase
          .from('customers')
          .select('id, tags')
          .ilike('whatsapp', `%${phone.slice(-8)}%`)
          .limit(1);

        if (customers && customers.length > 0) {
          const currentTags: string[] = customers[0].tags || [];
          if (!currentTags.includes('lembrar_live')) {
            await supabase.from('customers').update({
              tags: [...currentTags, 'lembrar_live'],
            }).eq('id', customers[0].id);
          }
        }
      }

      return {
        success: true,
        data: {
          confirmed: args.confirmed,
          message: args.confirmed ? 'Cliente registrado para lembrete da live!' : 'Cliente não quis lembrete.',
        },
      };
    }

    // ─── SEND PRODUCT IMAGE ───
    case 'send_product_image': {
      const query = args.query;
      const color = args.color || '';
      const caption = args.caption || '';
      const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
      const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

      let productTitle = query;
      let matchedProduct: any = null;
      let imageTargets: Array<{ url: string; color: string | null; caption: string; }> = [];

      if (shopifyDomain && shopifyToken) {
        try {
          const aggregatedProducts = new Map<string, any>();

          for (const searchQuery of buildShopifySearchQueries(query)) {
            const graphql = `{
              products(first: 8, query: "${searchQuery.replace(/"/g, '\\"')}") {
                edges {
                  node {
                    id
                    title
                    images(first: 20) {
                      edges { node { url altText } }
                    }
                    variants(first: 50) {
                      edges {
                        node {
                          title
                          selectedOptions { name value }
                          image { url }
                        }
                      }
                    }
                  }
                }
              }
            }`;

            const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
              method: 'POST',
              headers: {
                'X-Shopify-Access-Token': shopifyToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ query: graphql }),
            });

            const data = await resp.json();
            const products = data?.data?.products?.edges || [];
            console.log('[send_product_image] Shopify returned', products.length, 'products for query:', searchQuery);

            for (const { node: product } of products) {
              aggregatedProducts.set(product.id, product);
            }
          }

          const rankedProducts = Array.from(aggregatedProducts.values())
            .map((product: any) => ({
              product,
              score: scoreShopifyProduct(product, query, color),
            }))
            .sort((a, b) => b.score - a.score);

          matchedProduct = rankedProducts[0]?.product || null;

          if (matchedProduct) {
            productTitle = matchedProduct.title;
            const imageCandidates = collectProductImageCandidates(matchedProduct);
            console.log('[send_product_image] Selected product:', productTitle, 'with', imageCandidates.length, 'image candidates');

            if (color) {
              const colorNorm = normalizeShopifyText(color);
              const matchedCandidate = imageCandidates.find((candidate) => {
                const candidateColor = normalizeShopifyText(candidate.color);
                return candidateColor && (candidateColor.includes(colorNorm) || colorNorm.includes(candidateColor));
              });

              if (matchedCandidate) {
                imageTargets = [{
                  url: matchedCandidate.url,
                  color: matchedCandidate.color,
                  caption: caption || `${productTitle} - ${matchedCandidate.color || color}`,
                }];
                console.log('[send_product_image] Found variant image for color:', color, matchedCandidate.url);
              }
            } else {
              // When no color specified, send only VARIANT images (not general product gallery)
              // This avoids sending store photos, size charts, etc.
              const variantCandidates = imageCandidates.filter(c => c.source === 'variant');
              const candidatesToUse = variantCandidates.length > 0 ? variantCandidates : imageCandidates;
              const perColor = new Map<string, { url: string; color: string | null; caption: string; }>();
              for (const candidate of candidatesToUse) {
                const colorKey = normalizeShopifyText(candidate.color) || `image-${perColor.size + 1}`;
                if (perColor.has(colorKey)) continue;
                perColor.set(colorKey, {
                  url: candidate.url,
                  color: candidate.color,
                  caption: caption || `${productTitle}${candidate.color ? ` - ${candidate.color}` : ''}`,
                });
                // Cap at 4 images max to avoid flooding the client
                if (perColor.size >= 4) break;
              }
              imageTargets = Array.from(perColor.values());
              console.log('[send_product_image] Sending variant colors/images:', imageTargets.length, '(filtered from', imageCandidates.length, 'total candidates)');
            }
          }
        } catch (err) {
          console.error('[send_product_image] Shopify error:', err);
        }
      }

      if (imageTargets.length === 0) {
        const catalog = campaign.product_info?.catalogo || [];
        const searchLower = query.toLowerCase();
        const matched = catalog.find((p: any) =>
          (p.nome || '').toLowerCase().includes(searchLower) ||
          (p.keywords || []).some((kw: string) => searchLower.includes(kw.toLowerCase()))
        );
        if (matched?.imagem) {
          productTitle = matched.nome || query;
          imageTargets = [{
            url: matched.imagem,
            color: color || null,
            caption: caption || productTitle,
          }];
        }
      }

      if (imageTargets.length === 0) {
        try {
          await createAiAssistanceRequest(ctx, {
            requestType: 'product_photo',
            summary: color
              ? `Produto sem foto cadastrada na Shopify para envio: ${productTitle || query} na cor ${color}.`
              : `Produto sem fotos cadastradas na Shopify para envio: ${productTitle || query}.`,
            priority: 'high',
            productTitle: productTitle || query,
            shopifyProductId: matchedProduct?.id || null,
          });

          await supabase.from('support_tickets').insert({
            customer_phone: phone,
            source: 'jess_ai',
            subject: `Imagem não encontrada: ${String(productTitle || query).substring(0, 100)}`,
            description: color
              ? `A Shopify não retornou imagem para o produto ${productTitle || query} na cor ${color}.`
              : `A Shopify não retornou imagens para o produto ${productTitle || query}.`,
            priority: 'normal',
            customer_name: collectedData.nome || null,
          });
        } catch (ticketErr) {
          console.error('[send_product_image] support ticket error:', ticketErr);
        }

        return {
          success: false,
          error: color
            ? `Não encontrei imagem cadastrada na Shopify para ${productTitle || query} na cor ${color}.`
            : `Não encontrei imagens cadastradas na Shopify para ${productTitle || query}.`,
        };
      }

      try {
        const leadChannel = ctx.channel || lead?.channel || 'zapi';
        const whatsappNumberId = ctx.whatsappNumberId || lead?.whatsapp_number_id;
        const sentTargets: Array<{ url: string; color: string | null }> = [];
        const failedTargets: Array<{ url: string; color: string | null }> = [];

        for (const target of imageTargets.slice(0, 8)) {
          const sendPayload: any = {
            phone,
            mediaUrl: target.url,
            mediaType: 'image',
            caption: target.caption,
            whatsapp_number_id: whatsappNumberId,
          };

          let sendSuccess = false;

          if (leadChannel === 'meta') {
            const metaResp = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(sendPayload),
            });
            const metaData = await metaResp.json().catch(() => ({}));
            sendSuccess = metaResp.ok && !metaData?.error;
            console.log('[send_product_image] Meta response:', metaResp.status, JSON.stringify(metaData));
          } else {
            const zapiResp = await fetch(`${supabaseUrl}/functions/v1/zapi-send-media`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(sendPayload),
            });
            const zapiData = await zapiResp.json().catch(() => ({}));
            console.log('[send_product_image] Z-API attempt 1 response:', zapiResp.status, JSON.stringify(zapiData));
            sendSuccess = zapiResp.ok && zapiData?.success === true;

            if (!sendSuccess) {
              console.log('[send_product_image] First attempt failed, retrying with direct base64 download...');
              try {
                const imgResp = await fetch(target.url);
                if (imgResp.ok) {
                  const contentType = imgResp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
                  const bytes = new Uint8Array(await imgResp.arrayBuffer());
                  let binary = '';
                  const chunkSize = 0x8000;
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.subarray(i, i + chunkSize);
                    binary += String.fromCharCode(...chunk);
                  }
                  const base64 = btoa(binary);
                  const dataUri = `data:${contentType};base64,${base64}`;

                  const retryResp = await fetch(`${supabaseUrl}/functions/v1/zapi-send-media`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${supabaseKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ...sendPayload, mediaUrl: dataUri }),
                  });
                  const retryData = await retryResp.json().catch(() => ({}));
                  console.log('[send_product_image] Z-API retry response:', retryResp.status, JSON.stringify(retryData));
                  sendSuccess = retryResp.ok && retryData?.success === true;
                }
              } catch (retryErr) {
                console.error('[send_product_image] Retry base64 error:', retryErr);
              }
            }
          }

          await supabase.from('whatsapp_messages').insert({
            phone,
            message: `[IA-ADS] 📷 ${target.caption}`,
            direction: 'outgoing',
            media_type: 'image',
            media_url: target.url,
            whatsapp_number_id: whatsappNumberId,
            is_mass_dispatch: false,
            channel: leadChannel,
          });

          if (sendSuccess) sentTargets.push({ url: target.url, color: target.color });
          else failedTargets.push({ url: target.url, color: target.color });
        }

        if (sentTargets.length === 0) {
          console.error('[send_product_image] All send attempts failed for', imageTargets.map((target) => target.url));
          try {
            await createAiAssistanceRequest(ctx, {
              requestType: 'takeover_chat',
              summary: `As fotos do produto ${String(productTitle || query)} existem, mas não foram entregues ao cliente. Assumir atendimento e enviar manualmente.`,
              priority: 'high',
              productTitle: productTitle || query,
              shopifyProductId: matchedProduct?.id || null,
            });

            await supabase.from('support_tickets').insert({
              customer_phone: phone,
              source: 'jess_ai',
              subject: `Falha ao enviar imagem: ${String(productTitle).substring(0, 100)}`,
              description: `A Shopify retornou ${imageTargets.length} imagem(ns), mas nenhuma foi entregue ao cliente. Cor solicitada: ${color || 'não informada'}.`,
              priority: 'normal',
              customer_name: collectedData.nome || null,
            });
          } catch (ticketErr) {
            console.error('[send_product_image] support ticket error:', ticketErr);
          }

          return {
            success: false,
            error: 'Não consegui entregar as fotos agora.',
            data: {
              product_title: productTitle,
              requested_color: color || null,
              available_images_found: imageTargets.length,
              failed_images: failedTargets.length,
            },
          };
        }

        return {
          success: failedTargets.length === 0,
          data: {
            image_sent: true,
            product_title: productTitle,
            requested_color: color || null,
            sent_count: sentTargets.length,
            failed_count: failedTargets.length,
            colors_sent: sentTargets.map((target) => target.color).filter(Boolean),
            image_urls: sentTargets.map((target) => target.url),
            message: color
              ? `Foto do ${productTitle} enviada com sucesso!`
              : `${sentTargets.length} foto(s) do ${productTitle} enviada(s) com sucesso!`,
          },
        };
      } catch (err) {
        console.error('[send_product_image] Send error:', err);
        return { success: false, error: 'Erro ao enviar foto. Tente novamente em instantes.' };
      }
    }

    // ─── SCHEDULE FOLLOWUP ───
    case 'schedule_followup': {
      const date = args.date; // YYYY-MM-DD
      const time = args.time || '09:00';
      const reason = args.reason || '';
      const situationHint = args.situation_hint || null;

      try {
        // Parse date/time in São Paulo timezone
        const scheduledAt = new Date(`${date}T${time}:00-03:00`);

        // Validate it's in the future
        if (scheduledAt <= new Date()) {
          // If in the past, schedule for tomorrow at the same time
          scheduledAt.setDate(scheduledAt.getDate() + 1);
        }

        await supabase.from('chat_scheduled_followups').insert({
          phone,
          scheduled_at: scheduledAt.toISOString(),
          reason,
          situation_hint: situationHint,
          campaign_id: campaign.id,
          whatsapp_number_id: ctx.whatsappNumberId || lead?.whatsapp_number_id || null,
        });

        return {
          success: true,
          data: {
            scheduled_at: scheduledAt.toISOString(),
            reason,
            message: `Follow-up agendado para ${scheduledAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${scheduledAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`,
          },
        };
      } catch (err) {
        console.error('[schedule_followup] Error:', err);
        return { success: false, error: 'Erro ao agendar follow-up' };
      }
    }

    // ─── OPEN SUPPORT TICKET ───
    case 'open_support_ticket': {
      const question = args.question || '';
      const context = args.context || '';

      try {
        await createAiAssistanceRequest(ctx, {
          requestType: 'technical_info',
          summary: `Cliente pediu informação técnica que a IA não conseguiu confirmar: ${question.substring(0, 160)}`,
          priority: 'normal',
        });

        await supabase.from('support_tickets').insert({
          customer_phone: phone,
          source: 'jess_ai',
          subject: `Dúvida de produto: ${question.substring(0, 100)}`,
          description: `Cliente perguntou: "${question}"\nContexto: ${context}\nDados do lead: ${JSON.stringify(collectedData)}`,
          priority: 'normal',
          customer_name: collectedData.nome || null,
        });

        return {
          success: true,
          data: {
            message: 'Chamado aberto! Uma vendedora vai verificar e responder em breve.',
          },
        };
      } catch (err) {
        console.error('[open_support_ticket] Error:', err);
        return {
          success: true,
          data: {
            message: 'Vou verificar com a equipe e te retorno!',
          },
        };
      }
    }

    default:
      return { success: false, error: `Tool desconhecida: ${toolName}` };
  }
}
