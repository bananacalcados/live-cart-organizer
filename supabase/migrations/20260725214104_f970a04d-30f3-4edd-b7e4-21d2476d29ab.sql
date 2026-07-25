UPDATE public.customer_registrations
SET email = regexp_replace(lower(trim(email)), '@(gmail)\.(coma|con|comm|cim|c0m|om|cm|co)$', '@gmail.com')
WHERE email ~* '@gmail\.(coma|con|comm|cim|c0m|om|cm|co)$';

UPDATE public.customer_registrations
SET email = regexp_replace(lower(trim(email)), '@(hotmail)\.(coma|con|cm|co)$', '@hotmail.com')
WHERE email ~* '@hotmail\.(coma|con|cm|co)$';

UPDATE public.customer_registrations
SET email = regexp_replace(lower(trim(email)), '@(outlook|yahoo|icloud)\.(coma|con)$', '@\1.com')
WHERE email ~* '@(outlook|yahoo|icloud)\.(coma|con)$';