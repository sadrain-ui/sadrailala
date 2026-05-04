-- Institutional repair — lock `max_allowance` to text (Permit2 uint256 decimal strings).
-- Resolves Vault drift where `max_allowance` was created with non-text types (PostgREST 22P02).
DO $$
DECLARE
  dt text;
BEGIN
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'signatures'
    AND c.column_name = 'max_allowance';

  IF dt IS NULL THEN
    ALTER TABLE public.signatures ADD COLUMN max_allowance text;
  ELSIF dt = 'boolean' THEN
    ALTER TABLE public.signatures
      ALTER COLUMN max_allowance TYPE text
      USING (
        CASE
          WHEN max_allowance IS TRUE THEN 'true'
          WHEN max_allowance IS FALSE THEN 'false'
          ELSE NULL::text
        END
      );
  ELSIF dt <> 'text' AND dt <> 'character varying' THEN
    ALTER TABLE public.signatures
      ALTER COLUMN max_allowance TYPE text
      USING trim(max_allowance::text);
  END IF;
END $$;
