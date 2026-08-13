import { marked } from 'marked';
import { prisma } from '@superdesk/db';
import type { Scope } from '@superdesk/db/tenant';
import { AppError } from '@superdesk/shared/errors';
import { htmlToText } from '@/lib/sanitize';
import { sanitizeInboundHtml } from '@/lib/sanitize-html';
import { slugify } from '@/lib/workspace';

/**
 * Knowledge base — admin authoring and the public read/search paths.
 *
 * Articles are written as Markdown and stored as sanitized HTML, not raw
 * Markdown. Two reasons: the public site and the widget both need to render
 * instantly without a client-side Markdown parser, and running the same
 * allowlist sanitizer here as inbound email goes through means an admin
 * pasting Markdown that happens to contain raw HTML (Markdown allows that)
 * doesn't get a different trust boundary than anything else in the app that
 * ends up in `dangerouslySetInnerHTML`.
 */

async function firstFreeSlug(
  base: string,
  checkTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!(await checkTaken(candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueSectionSlug(workspaceId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || 'section';
  return firstFreeSlug(base, async (candidate) => {
    const clash = await prisma.section.findFirst({
      where: { workspaceId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return Boolean(clash);
  });
}

async function uniqueArticleSlug(workspaceId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || 'article';
  return firstFreeSlug(base, async (candidate) => {
    const clash = await prisma.article.findFirst({
      where: { workspaceId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return Boolean(clash);
  });
}

function markdownToSafeHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return sanitizeInboundHtml(raw);
}

// ---------------------------------------------------------------------------
// Admin: sections
// ---------------------------------------------------------------------------

export async function listSectionsAdmin(scope: Scope) {
  return prisma.section.findMany({
    where: { workspaceId: scope.workspaceId },
    orderBy: { position: 'asc' },
    include: {
      articles: {
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, slug: true, status: true, updatedAt: true, viewCount: true },
      },
    },
  });
}

export async function createSection(scope: Scope, input: { name: string; description?: string }) {
  const name = input.name.trim();
  if (!name) throw new AppError('BAD_REQUEST', 'Section name is required');

  const maxPosition = await prisma.section.aggregate({
    where: { workspaceId: scope.workspaceId },
    _max: { position: true },
  });

  const slug = await uniqueSectionSlug(scope.workspaceId, name);
  return prisma.section.create({
    data: {
      workspaceId: scope.workspaceId,
      name,
      slug,
      description: input.description?.trim() || null,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });
}

export async function updateSection(
  scope: Scope,
  id: string,
  input: { name?: string; description?: string; position?: number },
) {
  const section = await prisma.section.findFirst({ where: { id, workspaceId: scope.workspaceId } });
  if (!section) throw new AppError('NOT_FOUND', 'Section not found');

  const data: { name?: string; slug?: string; description?: string | null; position?: number } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AppError('BAD_REQUEST', 'Section name is required');
    data.name = name;
    if (name !== section.name) data.slug = await uniqueSectionSlug(scope.workspaceId, name, id);
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (input.position !== undefined) data.position = input.position;

  return prisma.section.update({ where: { id }, data });
}

export async function deleteSection(scope: Scope, id: string): Promise<void> {
  const result = await prisma.section.deleteMany({ where: { id, workspaceId: scope.workspaceId } });
  if (result.count === 0) throw new AppError('NOT_FOUND', 'Section not found');
  // Articles in it aren't deleted — onDelete: SetNull leaves them
  // uncategorized rather than destroying published content by accident.
}

// ---------------------------------------------------------------------------
// Admin: articles
// ---------------------------------------------------------------------------

export type ArticleInput = {
  title: string;
  sectionId?: string | null;
  excerpt?: string;
  markdown: string;
};

async function assertSectionOwnership(workspaceId: string, sectionId: string | null | undefined) {
  if (!sectionId) return;
  const section = await prisma.section.findFirst({ where: { id: sectionId, workspaceId }, select: { id: true } });
  if (!section) throw new AppError('BAD_REQUEST', 'Section not found');
}

/**
 * The flat article list — every article regardless of section, including
 * ones with no section at all. `listSectionsAdmin`'s nested
 * `section.articles` can't represent an uncategorized article (there's no
 * section object for it to nest under), which is exactly what made a newly
 * created article with no section picked invisible in the admin sidebar —
 * this is the source of truth the sidebar groups client-side instead.
 */
export async function listArticlesAdmin(scope: Scope, filter: { status?: 'DRAFT' | 'PUBLISHED' } = {}) {
  return prisma.article.findMany({
    where: { workspaceId: scope.workspaceId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      updatedAt: true,
      viewCount: true,
      sectionId: true,
    },
  });
}

export async function getArticleAdmin(scope: Scope, id: string) {
  const article = await prisma.article.findFirst({ where: { id, workspaceId: scope.workspaceId } });
  if (!article) throw new AppError('NOT_FOUND', 'Article not found');
  return article;
}

export async function createArticle(scope: Scope, input: ArticleInput) {
  const title = input.title.trim();
  if (!title) throw new AppError('BAD_REQUEST', 'Title is required');
  await assertSectionOwnership(scope.workspaceId, input.sectionId);

  const slug = await uniqueArticleSlug(scope.workspaceId, title);
  const bodyHtml = markdownToSafeHtml(input.markdown);
  const bodyText = htmlToText(bodyHtml);

  return prisma.article.create({
    data: {
      workspaceId: scope.workspaceId,
      sectionId: input.sectionId || null,
      title,
      slug,
      excerpt: input.excerpt?.trim() || bodyText.slice(0, 160) || null,
      bodyMarkdown: input.markdown,
      bodyHtml,
      bodyText,
      authorId: scope.userId,
    },
  });
}

export async function updateArticle(scope: Scope, id: string, input: Partial<ArticleInput>) {
  const article = await prisma.article.findFirst({ where: { id, workspaceId: scope.workspaceId } });
  if (!article) throw new AppError('NOT_FOUND', 'Article not found');
  if (input.sectionId !== undefined) await assertSectionOwnership(scope.workspaceId, input.sectionId);

  const data: {
    title?: string;
    slug?: string;
    sectionId?: string | null;
    excerpt?: string | null;
    bodyMarkdown?: string;
    bodyHtml?: string;
    bodyText?: string;
  } = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new AppError('BAD_REQUEST', 'Title is required');
    data.title = title;
    if (title !== article.title) data.slug = await uniqueArticleSlug(scope.workspaceId, title, id);
  }
  if (input.sectionId !== undefined) data.sectionId = input.sectionId || null;
  if (input.markdown !== undefined) {
    data.bodyMarkdown = input.markdown;
    data.bodyHtml = markdownToSafeHtml(input.markdown);
    data.bodyText = htmlToText(data.bodyHtml);
  }
  if (input.excerpt !== undefined) {
    data.excerpt = input.excerpt.trim() || data.bodyText?.slice(0, 160) || article.bodyText.slice(0, 160) || null;
  }

  return prisma.article.update({ where: { id }, data });
}

export async function setArticleStatus(scope: Scope, id: string, status: 'DRAFT' | 'PUBLISHED') {
  const article = await prisma.article.findFirst({ where: { id, workspaceId: scope.workspaceId } });
  if (!article) throw new AppError('NOT_FOUND', 'Article not found');

  return prisma.article.update({
    where: { id },
    data: {
      status,
      publishedAt: status === 'PUBLISHED' ? (article.publishedAt ?? new Date()) : article.publishedAt,
    },
  });
}

export async function deleteArticle(scope: Scope, id: string): Promise<void> {
  const result = await prisma.article.deleteMany({ where: { id, workspaceId: scope.workspaceId } });
  if (result.count === 0) throw new AppError('NOT_FOUND', 'Article not found');
}

// ---------------------------------------------------------------------------
// Public: the help site and in-widget search
// ---------------------------------------------------------------------------

export async function getPublicKbHome(workspaceSlug: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, name: true, kbEnabled: true, kbTitle: true, kbDescription: true },
  });
  if (!workspace || !workspace.kbEnabled) return null;

  const sections = await prisma.section.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { position: 'asc' },
    include: {
      articles: {
        where: { status: 'PUBLISHED' },
        orderBy: { title: 'asc' },
        select: { id: true, title: true, slug: true, excerpt: true },
      },
    },
  });

  const uncategorized = await prisma.article.findMany({
    where: { workspaceId: workspace.id, status: 'PUBLISHED', sectionId: null },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, slug: true, excerpt: true },
  });

  return { workspace, sections, uncategorized };
}

export async function getPublicArticle(workspaceSlug: string, articleSlug: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, name: true, kbEnabled: true, kbTitle: true },
  });
  if (!workspace || !workspace.kbEnabled) return null;

  const article = await prisma.article.findFirst({
    where: { workspaceId: workspace.id, slug: articleSlug, status: 'PUBLISHED' },
    include: { section: { select: { name: true, slug: true } } },
  });
  if (!article) return null;

  // Best-effort — a lost view count is not worth failing the page load over.
  prisma.article.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  return { workspace, article };
}

export type KbSearchResult = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  sectionSlug: string | null;
};

const SEARCH_LIMIT = 8;

export type RelevantArticle = { title: string; slug: string; bodyText: string };

/**
 * Same ILIKE-and-rank approach as searchPublicArticles, scoped by
 * workspaceId instead of a public slug lookup, and returning enough of the
 * body (not just the excerpt) to actually ground an AI-drafted reply —
 * lib/ai/draft-reply.ts's one caller. Kept separate from the public search
 * rather than generalizing that function: this one exists for the model to
 * read, not for a person to click through, so it needs different fields and
 * has no reason to also carry the public function's kbEnabled gate (a
 * disabled public KB doesn't mean an agent's draft assist should stop
 * consulting the workspace's own articles).
 */
// Common enough in a customer message to be useless as a match signal —
// filtered out before searching so "can you help me reset it" doesn't spend
// its keyword budget on "can" and "help" instead of "reset".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'it', 'this', 'that', 'do', 'does',
  'i', 'you', 'me', 'my', 'your', 'we', 'our', 'us', 'they', 'their',
  'can', 'could', 'would', 'should', 'will', 'just', 'get', 'got',
  'help', 'please', 'hi', 'hello', 'hey', 'thanks', 'thank', 'not', 'no',
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * A whole customer sentence — "I forgot my password, can you help me reset
 * it?" — almost never appears verbatim in an article, so this can't just
 * `contains` the raw query the way the public search box does (there, a
 * person types a short deliberate query; here, the input is natural
 * language). Extracted keywords instead, ranked by how many distinct
 * keywords each article matches — the closest a substring search gets to
 * "these are about the same thing" without a real search index.
 */
export async function findRelevantArticles(
  workspaceId: string,
  query: string,
  limit = 3,
): Promise<RelevantArticle[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const matches = await prisma.article.findMany({
    where: {
      workspaceId,
      status: 'PUBLISHED',
      OR: keywords.flatMap((kw) => [
        { title: { contains: kw, mode: 'insensitive' as const } },
        { bodyText: { contains: kw, mode: 'insensitive' as const } },
      ]),
    },
    take: limit * 4,
    select: { title: true, slug: true, bodyText: true },
  });

  const scored = matches
    .map((a) => {
      const haystack = `${a.title} ${a.bodyText}`.toLowerCase();
      const titleLower = a.title.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => haystack.includes(kw));
      // A title hit counts double — an article titled "Resetting your
      // password" is a stronger signal than one that merely mentions the
      // word "password" somewhere in a long body.
      const score = matchedKeywords.length + keywords.filter((kw) => titleLower.includes(kw)).length;
      return { article: a, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ article }) => ({
    title: article.title,
    slug: article.slug,
    bodyText: article.bodyText.slice(0, 800),
  }));
}

export async function searchPublicArticles(
  workspaceSlug: string,
  query: string,
): Promise<KbSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, kbEnabled: true },
  });
  if (!workspace || !workspace.kbEnabled) return [];

  const matches = await prisma.article.findMany({
    where: {
      workspaceId: workspace.id,
      status: 'PUBLISHED',
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        { bodyText: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: SEARCH_LIMIT * 3, // over-fetch, then rank in memory
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      section: { select: { slug: true } },
    },
  });

  const qLower = q.toLowerCase();
  const scored = matches
    .map((a) => ({
      article: a,
      // Title hits rank highest, then excerpt — a database-agnostic stand-in
      // for real relevance ranking that doesn't need a search extension for
      // a knowledge base this size.
      score: a.title.toLowerCase().includes(qLower) ? 2 : a.excerpt?.toLowerCase().includes(qLower) ? 1 : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_LIMIT);

  return scored.map(({ article }) => ({
    id: article.id,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    sectionSlug: article.section?.slug ?? null,
  }));
}
