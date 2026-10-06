-- Company logos may only be written by the uploadCompanyLogo server function
-- (service role), which validates type, signature, size and SVG safety.
-- Direct browser writes are revoked so the checks can't be bypassed.
DROP POLICY IF EXISTS "Company members write logos" ON storage.objects;
DROP POLICY IF EXISTS "Company members update logos" ON storage.objects;

UPDATE storage.buckets
SET file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']
WHERE id = 'company-logos';
