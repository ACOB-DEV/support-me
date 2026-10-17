/**
 * Links from in-app error messages to the project documentation.
 *
 * The docs live in the repository (not in the Next.js app), so links point at
 * the rendered Markdown on GitHub. Headings in those files become anchors
 * using GitHub's slug rules, which `headingAnchor` reproduces so an error
 * title can link straight to its section.
 */
export const DOCS_BASE_URL = 'https://github.com/ssupportme/support-me/blob/main/docs';

/** Path of the testnet troubleshooting guide, relative to the `docs/` folder. */
export const TROUBLESHOOTING_DOC = 'testnet-troubleshooting.md';

/**
 * GitHub-style heading anchor: lowercase, punctuation removed (letters,
 * numbers, spaces, `-` and `_` kept), each space replaced with `-`.
 * e.g. "Couldn't start subscription" -> "couldnt-start-subscription".
 */
export function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** URL of the troubleshooting guide section for a user-facing error title. */
export function troubleshootingUrl(title: string): string {
  return `${DOCS_BASE_URL}/${TROUBLESHOOTING_DOC}#${headingAnchor(title)}`;
}
