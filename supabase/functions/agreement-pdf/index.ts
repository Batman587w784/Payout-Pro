import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeaders, json, preflight, serviceClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";
import {
  SIGNATURE_STAMPS,
  STAMPS,
  TEMPLATE_BUCKET,
  TEMPLATE_OBJECT,
  type Stamp,
} from "../_shared/template.ts";

/**
 * GET /functions/v1/agreement-pdf?token=...
 *
 * Returns the completed agreement stamped onto the real template.
 *
 * Public (verify_jwt = false): the merchant is not a Payout Pro user. The token
 * stays valid for reads after it is burned for writes, because the merchant
 * needs a durable copy to show staff and guests. It cannot be reused to sign,
 * since used_at is already set.
 *
 * The template lives in a private Storage bucket rather than on disk, because
 * Edge Functions have no meaningful filesystem.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "Missing token" }, 400);

  const db = serviceClient();

  const { data: row } = await db
    .from("agreement_tokens")
    .select("agreement_id, agreements(id, status, rep_name, rep_signed_at)")
    .eq("token_hash", await hashToken(token))
    .maybeSingle();

  if (!row) return json({ error: "Not found." }, 404);

  const agreement = row.agreements as any;
  if (agreement.status !== "signed") return json({ error: "Not signed yet." }, 409);

  const { data: sig } = await db
    .from("signatures")
    .select("signer_name, submitted_fields, signature_value, signed_at")
    .eq("agreement_id", agreement.id)
    .single();

  if (!sig) return json({ error: "Signature missing." }, 500);

  const { data: file, error: dlErr } = await db.storage
    .from(TEMPLATE_BUCKET)
    .download(TEMPLATE_OBJECT);

  if (dlErr || !file) return json({ error: "Template unavailable." }, 500);

  const pdfBytes = await fillTemplate(
    new Uint8Array(await file.arrayBuffer()),
    {
      fields: sig.submitted_fields as Record<string, string>,
      partnerSignature: sig.signature_value,
      partnerDate: sig.signed_at,
      repName: agreement.rep_name,
      repDate: agreement.rep_signed_at,
    },
  );

  return new Response(pdfBytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'inline; filename="tailgate-partnership-agreement.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
});

// ---------------------------------------------------------------------------

interface FillArgs {
  fields: Record<string, string>;
  partnerSignature: string;
  partnerDate: string;
  repName: string | null;
  repDate: string | null;
}

async function fillTemplate(
  templateBytes: Uint8Array,
  args: FillArgs,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes);

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Closest built-in to a handwritten mark without shipping a custom font.
  const script = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const page = pdf.getPages()[0];
  const ink = rgb(0.1, 0.11, 0.14);

  const draw = (text: string, s: Stamp, font: any) => {
    if (!text) return;
    let size = s.size;
    // Shrink to fit the blank rather than overflowing into the next label.
    while (size > 6 && font.widthOfTextAtSize(text, size) > s.maxWidth) {
      size -= 0.5;
    }
    page.drawText(text, { x: s.x, y: s.y, size, font, color: ink });
  };

  for (const [key, stamp] of Object.entries(STAMPS)) {
    draw(String(args.fields[key] ?? "").trim(), stamp, helv);
  }

  draw(args.partnerSignature, SIGNATURE_STAMPS.partner_signature, script);
  draw(shortDate(args.partnerDate), SIGNATURE_STAMPS.partner_date, helv);

  if (args.repName) draw(args.repName, SIGNATURE_STAMPS.rep_signature, script);
  if (args.repDate) {
    draw(shortDate(args.repDate), SIGNATURE_STAMPS.rep_date, helv);
  }

  // Audit footer, so a printed copy still carries proof of how it was signed.
  page.drawText(
    `Signed electronically on ${new Date(args.partnerDate).toUTCString()}`,
    { x: 17, y: 96, size: 7, font: helvBold, color: rgb(0.42, 0.45, 0.5) },
  );

  return await pdf.save();
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
