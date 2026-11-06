// The card on file, as the app shows it.
//
// Pure, so the confirm screen, the cancel dialog and the payments page can name
// the card without importing the server half (./cards).

export interface SavedCard {
  /** Stripe's brand id: 'visa', 'mastercard', 'amex', … */
  brand: string
  last4: string
  expMonth: number | null
  expYear: number | null
}

/** The flag the card gate's 409 carries, so the client knows to ask for one. */
export const CARD_REQUIRED_CODE = 'card_required'

export const CARD_REQUIRED_MESSAGE =
  'Add a card to hold your spot. It’s only charged if you cancel late.'

/** The flag a refused removal's 409 carries: the card is guaranteeing rounds. */
export const CARD_IN_USE_CODE = 'card_in_use'

/**
 * Why a card can't be removed yet. Edit is offered instead because a different
 * card guarantees the same rounds — it's the card going missing that can't
 * happen while a late cancel could still be charged to it.
 */
export function cardInUseMessage(rounds: number): string {
  const which = rounds === 1 ? 'an upcoming round' : `${rounds} upcoming rounds`
  return `This card is holding your spot on ${which}. Edit it to use a different card, or remove it once ${rounds === 1 ? 'that round has' : 'they’ve'} been played.`
}

const BRAND_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}

/** "Visa •••• 4242" — the card named the way its owner would recognise it. */
export function cardLabel(card: Pick<SavedCard, 'brand' | 'last4'>): string {
  const brand = BRAND_NAMES[card.brand] ?? (card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card')
  return `${brand} •••• ${card.last4}`
}

/** "Expires 04/29", or '' where Stripe didn't say. */
export function cardExpiry(card: Pick<SavedCard, 'expMonth' | 'expYear'>): string {
  if (!card.expMonth || !card.expYear) return ''
  return `Expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
}

/** A member_payment_methods row as a card, or null when no card is saved on it. */
export function cardFromRow(
  row: {
    stripe_payment_method_id?: string | null
    card_brand?: string | null
    card_last4?: string | null
    card_exp_month?: number | null
    card_exp_year?: number | null
  } | null | undefined,
): SavedCard | null {
  if (!row?.stripe_payment_method_id || !row.card_last4) return null
  return {
    brand: row.card_brand ?? '',
    last4: row.card_last4,
    expMonth: row.card_exp_month ?? null,
    expYear: row.card_exp_year ?? null,
  }
}
