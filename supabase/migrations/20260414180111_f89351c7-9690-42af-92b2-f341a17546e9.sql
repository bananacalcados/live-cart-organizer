-- Fix Vivi Azevedo's messages that were stored with a WhatsApp LID instead of real phone
UPDATE whatsapp_messages 
SET phone = '5533999622745' 
WHERE phone = '279039847731413';

-- Also clean up chat_contacts if there's a LID entry
DELETE FROM chat_contacts WHERE phone = '279039847731413';