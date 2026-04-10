-- Clean up duplicate/orphan finished conversation entries for Matthews
DELETE FROM chat_finished_conversations 
WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = '91955003';