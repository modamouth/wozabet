/** A deposit (collection) request we send to a payment provider. Amounts are integer cents (NAD). */
export interface CollectionRequest {
  /** Our payment id. Providers echo it back in the webhook so we can match the payment. */
  reference: string;
  amountCents: number;
  /** Payer's mobile number in international format without '+', e.g. 264811234567. */
  msisdn: string;
  callbackUrl: string;
}

/** A provider webhook, normalised. */
export interface PaymentEvent {
  reference: string; // our payment id
  providerRef: string; // the provider's transaction id
  status: 'succeeded' | 'failed';
  amountCents: number;
  currency: string;
  failureReason?: string;
}

export interface PaymentProvider {
  /** Stable short name. Used in the webhook URL (/api/payments/webhook/<name>) and stored on payment rows. */
  name: string;
  /** Ask the provider to send a payment request to the user's phone. Returns the provider's transaction id. */
  initiateCollection(req: CollectionRequest): Promise<{ providerRef: string | null }>;
  /** Check the webhook signature against the RAW request body. Return false if it is invalid or too old. */
  verifyWebhook(rawBody: string, headers: Headers, now?: Date): boolean;
  /** Turn a verified webhook body into a PaymentEvent (throw on bad shape). */
  parseWebhook(rawBody: string): PaymentEvent;
}
