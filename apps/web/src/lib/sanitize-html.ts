import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist sanitizer for HTML we didn't write.
 *
 * Inbound email is the first real consumer: a message body composed by
 * whatever mail client the customer used, arriving as HTML we render with
 * `dangerouslySetInnerHTML` right next to an agent's own messages in the
 * thread. Escaping (as agent-composed plain text gets, in lib/conversations.ts)
 * would just print the tags literally — this instead keeps a small set of
 * formatting tags and strips everything else: no `<script>`, no `<style>`,
 * no inline `style=` (a `url()`/`expression()` value is a real exfiltration
 * vector and the formatting it buys isn't worth defending against it), no
 * `on*` handlers, no `javascript:` URLs.
 *
 * The knowledge base editor (Req 5) will be the second consumer, with the
 * same function — an admin's own account isn't a trust boundary the widget
 * or an inbound email is, but the article content still ends up rendered to
 * every visitor of the public help site.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'img', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div',
];

export function sanitizeInboundHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    // Drop the content of tags that shouldn't render at all rather than
    // unwrapping it — a <script> or <style> body isn't safe text either.
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'head'],
    allowedIframeHostnames: [],
    disallowedTagsMode: 'discard',
  });
}
