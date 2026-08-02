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
// Bilingual feedback form. Spec and regenerate script: `docs/15_feedback_form.md`.
// Editing the form's questions or theme does not change this URL, so only a
// change to the URL itself needs a release.
export const FEEDBACK_FORM_URL = "https://forms.gle/SnJrL1GY1XqnkCqn9";

/**
 * The same form as a long-form URL with the version box pre-filled.
 *
 * Two reasons this can't just be the short link with a query string appended:
 * `forms.gle` is a redirector and drops parameters, and the prefill needs the
 * field's own entry id. `__VERSION__` is the substitution slot — see
 * `feedbackFormUrl` below.
 */
const FEEDBACK_FORM_PREFILL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdC0CiLwXPfU0CBeknbff-9t3NJg4VgyGCDxBpEH-5MXJEbrg/viewform" +
  "?usp=pp_url&entry.1181019611=__VERSION__";

/**
 * Feedback URL to open, with the running version filled in when it is known.
 *
 * The version is the single most useful field in the form and the one a user is
 * least able to supply — it means opening Settings to look it up, so left to
 * them it arrives blank or as "latest". Falls back to the plain short link when
 * the version can't be resolved, so the button can never fail to open.
 */
export function feedbackFormUrl(version?: string): string {
  if (!FEEDBACK_FORM_URL) return "";
  if (!version) return FEEDBACK_FORM_URL;
  return FEEDBACK_FORM_PREFILL.replace("__VERSION__", encodeURIComponent(version));
}
