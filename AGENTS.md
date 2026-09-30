# Project architecture rules

- Every public payment surface must resolve `payment_splits` before rendering a charge; never fall back to the full order total when split status cannot be loaded, because that can double-charge a customer.
- WhatsApp replies must preserve the provider message ID end-to-end (`quoted_message_id`) so quoted context renders for both customer and staff.- Meta Ads token renewed by meta-ads-sync is stored in Vault (meta_ads_token_state + meta_ads_get_token/set_token RPCs, service_role only) and read before the META_ADS_ACCESS_TOKEN secret, because edge functions cannot rewrite secrets.
