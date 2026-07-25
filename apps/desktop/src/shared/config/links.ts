/**
 * External support links — the single place to fill in the donation and
 * feedback URLs before launch.
 *
 * These are read by Settings → Support (all three) and the `/feedback` slash
 * command (feedback only). An empty string means "not set up yet": the Support
 * buttons render disabled with a "coming soon" tag, and `/feedback` no-ops. So
 * the app ships now and never links to a page that does not exist — turning a
 * link on is a one-line edit here.
 */

export const KO_FI_URL = "https://ko-fi.com/stratsix";
export const SAWERIA_URL = "https://saweria.co/stratsix";
// TODO(Saputra): paste the Google Form URL once the feedback form exists.
export const FEEDBACK_FORM_URL = "";
