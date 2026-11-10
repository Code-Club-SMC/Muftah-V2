/**
 * What the operator reads when an offline invoice could not be posted.
 *
 * Raw errors never reach the screen: they can carry database internals. Each
 * known failure gets a plain sentence that says what went wrong and what to do
 * next. Anything unknown gets the generic message below.
 */

const STOCK_SETUP_HELP =
  "Nothing was posted. Ask the stock team to check the product's carton packaging and stock record, then press Refresh live checks and post again.";

const REFRESH_HELP = "Press Refresh live checks and try again.";

const FRIENDLY: Array<{ startsWith: string[]; message: string }> = [
  {
    startsWith: ["Carton adjustment exceeds finished goods stock"],
    message: `Stock for a product on this invoice could not be reduced. The system counts none of it, even if the shelf has stock, because the product's carton setup does not match its stock record. ${STOCK_SETUP_HELP}`,
  },
  {
    startsWith: [
      "Finished goods stock must exist",
      "Carton recipe not found",
      "Carton adjustment would make inventory value negative",
    ],
    message: `Stock for a product on this invoice could not be updated because its stock record or value is missing or wrong. ${STOCK_SETUP_HELP}`,
  },
  {
    startsWith: ["Signed product", "A signed product"],
    message: `A product on this invoice was removed or switched off after the invoice was written. Ask the office to switch the product back on, or exclude this invoice. ${REFRESH_HELP}`,
  },
  {
    startsWith: ["Signed distributor", "Signed customer"],
    message: `The customer on this invoice was removed or changed after the invoice was written. Check the customer in Sales → People, then press Refresh live checks.`,
  },
  {
    startsWith: ["Payment wallet requires review"],
    message: `A payment on this invoice goes to an account that is missing or the wrong kind, for example cash paid into a bank account. Fix the payment account, then press Refresh live checks.`,
  },
  {
    startsWith: ["Posted total does not match"],
    message: `The total the system worked out is different from the total on the paper invoice. Nothing was posted. Compare the products, prices and discounts with the paper copy. If the paper copy is wrong, exclude this invoice.`,
  },
  {
    startsWith: ["Signed offline factory warehouse"],
    message: `The factory warehouse used for this invoice is no longer available. Ask an admin to check the warehouse, then press Refresh live checks.`,
  },
  {
    startsWith: [
      "Offline invoice is not approved for posting",
      "Offline invoice identity is incomplete",
    ],
    message: `This invoice changed while it was being posted, so it was stopped for safety. ${REFRESH_HELP}`,
  },
];

// These already name the product, customer or amount, so the operator can read them as they are.
const READABLE_PREFIXES = [
  "Signed booked order",
  "Approved existing dispatch invoice",
  "Incorrect online invoice",
  "Signed offline line",
  "Signed offline pricing",
  "Salesman is required",
  "New customer",
  "Discount",
  "Custom pack sizes",
  "Payment Due Date",
  "Payment amount",
  "Destination account",
  "Bank reference",
  "Cheque",
  "Not enough",
  'Customer "',
];

export const GENERIC_POST_ERROR =
  "The system hit an unexpected problem while posting this invoice. Nothing was posted and nothing was lost. Press Refresh live checks and try again. If it fails again, tell IT support the invoice number.";

export function describePostError(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC_POST_ERROR;
  const raw = error.message;
  const friendly = FRIENDLY.find((rule) => rule.startsWith.some((prefix) => raw.startsWith(prefix)));
  if (friendly) return friendly.message;
  if (READABLE_PREFIXES.some((prefix) => raw.startsWith(prefix))) return raw.slice(0, 500);
  return GENERIC_POST_ERROR;
}
