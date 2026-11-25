CREATE TRIGGER trg_live_mark_last4_conflicts AFTER INSERT OR UPDATE OF phone_last4 ON orders FOR EACH ROW EXECUTE FUNCTION public.live_mark_last4_conflicts();
INSERT INTO live_code_settings VALUES('00000000-0000-0000-0000-000000000012','active','{}');
DO $$
DECLARE cid uuid:='00000000-0000-0000-0000-000000000001'; oid uuid; result text;
BEGIN
 IF (SELECT phone_last4 FROM customers WHERE id=cid)<>'3209' THEN RAISE EXCEPTION 'Cancelled order not backfilled'; END IF;
 INSERT INTO orders(customer_id,event_id,stage) VALUES(cid,'00000000-0000-0000-0000-000000000012','incomplete_order') RETURNING id INTO oid;
 IF (SELECT phone_last4 FROM orders WHERE id=oid)<>'3209' THEN RAISE EXCEPTION 'Next live lost digits'; END IF;
 UPDATE orders SET stage='cancelled' WHERE id=oid;
 IF (SELECT phone_last4 FROM customers WHERE id=cid)<>'3209' OR (SELECT phone_last4 FROM orders WHERE id=oid)<>'3209' THEN RAISE EXCEPTION 'Cancellation erased digits'; END IF;
 UPDATE orders SET phone_last4='4321' WHERE id=oid;
 IF (SELECT phone_last4 FROM customers WHERE id=cid)<>'4321' THEN RAISE EXCEPTION 'Manual change failed'; END IF;
 UPDATE orders SET phone_last4=NULL WHERE id=oid;
 IF (SELECT phone_last4 FROM customers WHERE id=cid) IS NOT NULL THEN RAISE EXCEPTION 'Manual clear failed'; END IF;
 INSERT INTO orders(customer_id,event_id,stage) VALUES(cid,'00000000-0000-0000-0000-000000000012','incomplete_order') RETURNING id INTO oid;
 IF (SELECT phone_last4 FROM orders WHERE id=oid) IS NOT NULL THEN RAISE EXCEPTION 'Cleared digits returned'; END IF;
 result:=process_live_comment_codes('comment-final','00000000-0000-0000-0000-000000000012','eni.nogueirarp','final 7788');
 IF result<>'no_intent' OR (SELECT phone_last4 FROM customers WHERE id=cid)<>'7788' THEN RAISE EXCEPTION 'New comment without cart did not save final: %',result; END IF;
 PERFORM process_live_comment_codes('comment-final','00000000-0000-0000-0000-000000000012','eni.nogueirarp','final 9999');
 IF (SELECT phone_last4 FROM customers WHERE id=cid)<>'7788' THEN RAISE EXCEPTION 'Duplicate replaced final'; END IF;
 INSERT INTO model_number_tokens VALUES('9900');
 PERFORM process_live_comment_codes('model-only','00000000-0000-0000-0000-000000000012','eni.nogueirarp','9900');
 IF (SELECT phone_last4 FROM customers WHERE id=cid)<>'7788' THEN RAISE EXCEPTION 'Model code replaced final'; END IF;
 INSERT INTO orders(customer_id,event_id,stage) VALUES(cid,'00000000-0000-0000-0000-000000000012','incomplete_order') RETURNING id INTO oid;
 IF (SELECT phone_last4 FROM orders WHERE id=oid)<>'7788' THEN RAISE EXCEPTION 'Next cart did not read new final'; END IF;
 IF (SELECT whatsapp FROM customers WHERE id=cid) IS NOT NULL THEN RAISE EXCEPTION 'Final falsely verified full phone'; END IF;
 RAISE NOTICE 'PASS: cancelled history, inheritance, cancellation, manual edit/clear, new comment, duplicate, model token, no phone ownership';
END $$;
