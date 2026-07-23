/**
 * Field map for Discount_Partnership_Agreement.pdf (template v1).
 *
 * Coordinates were measured off the real PDF and visually verified. Page is US
 * Letter, 612 x 792pt. pdf-lib uses a bottom-left origin, so these y values are
 * already converted from the top-down values measuring tools report.
 *
 * This file is the only place coordinates live. If the template is ever
 * re-exported, re-measure here and nowhere else.
 */

export const TEMPLATE_VERSION = "discount-partnership-v1";

/** Path inside the private Supabase Storage bucket. */
export const TEMPLATE_BUCKET = "agreements";
export const TEMPLATE_OBJECT = "discount-partnership-v1.pdf";

export const PAGE = { width: 612, height: 792 } as const;

export const FIELD_LABELS = {
  business_name: "Business name",
  contact_person: "Contact person",
  phone: "Phone",
  email: "Email",
  address: "Address",
  discount_offered: "Discount offered",
} as const;

export interface Stamp {
  x: number;
  y: number;
  size: number;
  /** Max width before the value shrinks to fit its blank. */
  maxWidth: number;
}

export const STAMPS: Record<string, Stamp> = {
  business_name:    { x: 116, y: 401, size: 11, maxWidth: 204 },
  contact_person:   { x: 118, y: 385, size: 11, maxWidth: 204 },
  phone:            { x:  65, y: 370, size: 11, maxWidth:  94 },
  email:            { x: 207, y: 370, size: 11, maxWidth: 134 },
  address:          { x:  76, y: 355, size: 11, maxWidth: 245 },
  // The discount rule is rasterized inside a page image rather than being live
  // text, so this one was measured off the render. Most likely to need a nudge.
  discount_offered: { x:  34, y: 273, size: 12, maxWidth: 360 },
};

export const SIGNATURE_STAMPS = {
  partner_signature: { x: 122, y: 192, size: 12, maxWidth: 92 },
  partner_date:      { x: 252, y: 192, size: 11, maxWidth: 50 },
  rep_signature:     { x: 154, y: 164, size: 12, maxWidth: 71 },
  rep_date:          { x: 262, y: 164, size: 11, maxWidth: 50 },
} as const;

/**
 * Plain-text terms shown on the signing page above the fields. Kept verbatim
 * from the PDF so the signer reads the same words they are signing.
 */
export const AGREEMENT_BODY =
  `Thank you for supporting our local community through Tailgate Co. By submitting your discount, you authorize Tailgate Co. to feature your business name, logo, and offer on fundraising cards and related promotional materials (cards, social media, etc.). Tailgate may distribute this offer through schools, nonprofit organizations, corporate partners, independent campaigns, or directly to consumers through Tailgate's digital or physical platforms. Once printing begins, discounts cannot be changed or withdrawn for the remainder of the season.

This initiative supports:
  - Discounts for multiple groups within the community.
  - No upfront payment is required from partnering businesses.
  - Cards remain active for 12 months from each print date.

You agree to honor the submitted discount, ensure your staff is aware and able to redeem it, and understand that your discount may appear on multiple cards until an updated discount is submitted through our website. Any changes you make will apply to the next print cycle. Discounts must be redeemed through the Tailgate mobile or web redemption page. Physical cards alone are not valid for redemption.

Both NFC and traditional printed cards are valid and must be accepted by participating businesses.`;
