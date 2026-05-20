// GHL-specific types that go beyond the shared GHLContact type.
// The shared GHLContact in src/types/index.ts is kept for backward
// compatibility; types here are GHL-integration-layer concerns only.

export interface GHLWebhookPayload {
  type: string
  locationId: string
  contactId: string
  id?: string
  // Contact fields (present on contact.updated events)
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  tags?: string[]
  customFields?: Array<{ id: string; value: string }>
}

export type GHLWebhookEvent =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.tag.added'
  | 'contact.tag.removed'
  | 'contact.deleted'
