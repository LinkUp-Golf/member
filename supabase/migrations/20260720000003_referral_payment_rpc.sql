-- Record a referral commission payment and its line items atomically.
--
-- The payment route previously inserted the payment row, then its line items,
-- in two separate round-trips with an app-level rollback. A crash or dropped
-- connection between the two (or a failed rollback) left a paid month with no
-- line items — so referral_partner_payment_items_link_unique, the guard that
-- stops a conversion being paid twice across months, was never armed for those
-- links. This function does both writes in one transaction: if the items
-- insert violates any unique constraint, the payment insert rolls back with it.

CREATE OR REPLACE FUNCTION record_referral_payment(
  p_partner_id        uuid,
  p_period_month      date,
  p_calculated_amount numeric,
  p_amount            numeric,
  p_note              text,
  p_paid_by           uuid,
  p_items             jsonb
) RETURNS referral_partner_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment referral_partner_payments;
BEGIN
  INSERT INTO referral_partner_payments
    (referral_partner_id, period_month, calculated_amount, amount, conversion_count, note, paid_by)
  VALUES
    (p_partner_id, p_period_month, p_calculated_amount, p_amount,
     COALESCE(jsonb_array_length(p_items), 0), p_note, p_paid_by)
  RETURNING * INTO v_payment;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    INSERT INTO referral_partner_payment_items
      (payment_id, link_id, email, name, converted_at, commission)
    SELECT
      v_payment.id,
      NULLIF(item->>'link_id', '')::uuid,
      item->>'email',
      item->>'name',
      (item->>'converted_at')::date,
      (item->>'commission')::numeric
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  RETURN v_payment;
END;
$$;

-- Payments are money. The function is SECURITY DEFINER (bypasses RLS), so it
-- must NOT be callable by ordinary users via PostgREST — otherwise any
-- authenticated member could write payment rows. Only the service role (used by
-- the server-side admin route) may execute it.
REVOKE ALL ON FUNCTION record_referral_payment(uuid, date, numeric, numeric, text, uuid, jsonb) FROM public;
REVOKE ALL ON FUNCTION record_referral_payment(uuid, date, numeric, numeric, text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION record_referral_payment(uuid, date, numeric, numeric, text, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION record_referral_payment(uuid, date, numeric, numeric, text, uuid, jsonb) TO service_role;
