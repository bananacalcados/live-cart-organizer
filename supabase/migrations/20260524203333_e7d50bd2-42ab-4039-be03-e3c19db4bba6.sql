-- Deduplicate event_lead leads (campaign_tag = event_lead:884ee598...)
-- Keep one row per phone, preferring: converted=true > source=event_typebot > earliest created_at
WITH ranked AS (
  SELECT id, phone,
    ROW_NUMBER() OVER (
      PARTITION BY phone
      ORDER BY 
        (converted = true) DESC NULLS LAST,
        (source = 'event_typebot') DESC,
        created_at ASC
    ) AS rn
  FROM lp_leads
  WHERE campaign_tag = 'event_lead:884ee598-acbb-42a1-9c56-2fd2a13bbe74'
)
DELETE FROM lp_leads WHERE id IN (SELECT id FROM ranked WHERE rn > 1);