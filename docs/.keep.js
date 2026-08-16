/**
 * Complimentary guests and the email flow.
 *
 * Registration alone puts a contact on the main event tag, which is what the
 * whole A-sequence keys off. Marking someone complimentary must therefore do
 * two things at once:
 *
 *   - add "- Complimentary" so revenue reporting can exclude them
 *   - add "- Paid"          so the payment reminder stops chasing them
 *
 * This module exists only to document that pairing; the logic lives in
 * server.js at /admin/comp. See docs/EMAIL-FLOW.md for the full matrix.
 */

module.exports = {};
