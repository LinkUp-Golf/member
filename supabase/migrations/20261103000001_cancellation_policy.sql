-- The cancellation policy, and the card it is charged to.
--
-- A seat given up late costs a share of its own price: half of it the day
-- before the round, all of it on the day (the tiers live in one place, in
-- src/lib/cancellation/policy.ts, and are applied to each seat's own price —
-- so a $150 round and a $300 round need no configuration between them).
--
-- Until now nothing in the app held a way to pay. Rounds are settled through a
-- venue's checkout or at the club, both after the fact, so there was nothing to
-- charge when someone cancelled. The policy is only as good as its collection,
-- which means a card on file: saved through Stripe when a member books, charged
-- off-session if they cancel inside the window, and never touched otherwise.
-- ------------------------------------------------------------

-- ---- The card on file ----------------------------------------
--
-- One row per member: their Stripe customer and the card a late cancellation
-- is charged to. Its own table rather than columns on members, because member
-- rows are read across the directory and a Stripe id has no business in that
-- response. The customer is created before a card is saved (a SetupIntent needs
-- one), so the card columns are empty until the member finishes entering it.
--
-- Brand, last four and expiry are copied off the payment method so the app can
-- say which card it means without a Stripe call on every screen that shows it.

CREATE TABLE IF NOT EXISTS member_payment_methods (
  member_id                 uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  stripe_customer_id        text NOT NULL UNIQUE,
  stripe_payment_method_id  text,
  card_brand                text,
  card_last4                text,
  card_exp_month            smallint,
  card_exp_year             smallint,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS member_payment_methods_updated_at ON member_payment_methods;
CREATE TRIGGER member_payment_methods_updated_at
  BEFORE UPDATE ON member_payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE member_payment_methods ENABLE ROW LEVEL SECURITY;

-- A member can see their own card; admins can see anyone's. Writes only happen
-- after a Stripe call has said what the card is, so they go through the
-- service-role routes under /api/payments and the Stripe webhook — no INSERT,
-- UPDATE or DELETE policy.
DROP POLICY IF EXISTS "Members view their own payment method" ON member_payment_methods;
CREATE POLICY "Members view their own payment method"
  ON member_payment_methods FOR SELECT
  USING (member_id = auth.uid() OR is_admin());


-- ---- What a late cancellation cost ---------------------------
--
-- One row per seat given up inside the window. Written *before* the seat is
-- released, so a member can never get a late cancellation for free because a
-- write failed after it — if this insert fails, the cancel is refused and
-- nothing has changed.
--
-- The seat itself is described here rather than referenced: a member's cancel
-- deletes the booking row outright (see deleteBookingEverywhere), so a foreign
-- key would either block the cancel or take the record of the fee with it.
-- booking_id is kept as a plain uuid — unique, so a double tap on Cancel can't
-- record the same seat twice.
--
-- status:
--   pending  recorded, charge not yet settled (in flight, or Stripe is still
--            processing it — the webhook settles it).
--   paid     the card was charged, or the member paid through the fallback link.
--   unpaid   the card was declined, needed authentication, or there was no card;
--            the member has been asked to pay from /more/payments.
--   waived   an admin let it go. Nothing sets this yet; it's here so letting a
--            fee go is a status change, not a delete of the record.

CREATE TABLE IF NOT EXISTS cancellation_fees (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who cancelled, and so who pays.
  member_id                   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  source                      text NOT NULL CHECK (source IN ('booking', 'hosted_event')),
  booking_id                  uuid,
  hosted_event_id             uuid REFERENCES hosted_events(id) ON DELETE SET NULL,
  hosted_event_registration_id uuid,
  course_id                   uuid REFERENCES courses(id) ON DELETE SET NULL,
  -- The round as it was when it was cancelled, for the receipt.
  course_name                 text,
  event_date                  date NOT NULL,
  tee_time                    text,
  -- The seat's price, the share of it the policy took, and what that came to.
  price                       numeric(10,2) NOT NULL CHECK (price >= 0),
  percent                     smallint NOT NULL CHECK (percent BETWEEN 1 AND 100),
  amount                      numeric(10,2) NOT NULL CHECK (amount > 0),
  status                      text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'paid', 'unpaid', 'waived')),
  stripe_payment_intent_id    text,
  stripe_checkout_session_id  text,
  -- Stripe's decline code, or why no charge was attempted ('no_card').
  failure_reason              text,
  paid_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cancellation_fees_booking_uidx
  ON cancellation_fees (booking_id) WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cancellation_fees_registration_uidx
  ON cancellation_fees (hosted_event_registration_id) WHERE hosted_event_registration_id IS NOT NULL;

-- A member's own list on /more/payments.
CREATE INDEX IF NOT EXISTS cancellation_fees_member_idx
  ON cancellation_fees (member_id, created_at DESC);

-- The webhook finds a fee by the PaymentIntent it was charged with.
CREATE INDEX IF NOT EXISTS cancellation_fees_payment_intent_idx
  ON cancellation_fees (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

DROP TRIGGER IF EXISTS cancellation_fees_updated_at ON cancellation_fees;
CREATE TRIGGER cancellation_fees_updated_at
  BEFORE UPDATE ON cancellation_fees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE cancellation_fees ENABLE ROW LEVEL SECURITY;

-- Members see what they've been charged; admins see everyone's. Every write is
-- a cancel route, a Stripe call or the Stripe webhook, all service-role.
DROP POLICY IF EXISTS "Members view their own cancellation fees" ON cancellation_fees;
CREATE POLICY "Members view their own cancellation fees"
  ON cancellation_fees FOR SELECT
  USING (member_id = auth.uid() OR is_admin());


-- ---- Which seats the policy covers ---------------------------
--
-- Only seats booked after it existed. A member who booked tomorrow's round last
-- week agreed to no fee and gave us no card, and charging them for a rule that
-- appeared after they booked is how a fee turns into a chargeback.
--
-- Added false, so every seat that already exists is outside the policy, and
-- then defaulted true, so every seat written from here on is inside it — by the
-- booking RPCs as much as by any route, without either needing to know.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancellation_policy_applies boolean NOT NULL DEFAULT false;
ALTER TABLE bookings
  ALTER COLUMN cancellation_policy_applies SET DEFAULT true;

ALTER TABLE hosted_event_registrations
  ADD COLUMN IF NOT EXISTS cancellation_policy_applies boolean NOT NULL DEFAULT false;
ALTER TABLE hosted_event_registrations
  ALTER COLUMN cancellation_policy_applies SET DEFAULT true;
