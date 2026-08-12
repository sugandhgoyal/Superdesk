import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPublicArticle } from '@/lib/kb';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}): Promise<Metadata> {
  const { slug, articleSlug } = await params;
  const data = await getPublicArticle(slug, articleSlug);
  if (!data) return {};
  return {
    title: `${data.article.title} — ${data.workspace.kbTitle || data.workspace.name}`,
    description: data.article.excerpt ?? undefined,
    robots: { index: true, follow: true },
  };
}

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}) {
  const { slug, articleSlug } = await params;
  const data = await getPublicArticle(slug, articleSlug);
  if (!data) notFound();

  const { workspace, article } = data;

  return (
    <div className="min-h-full bg-bg-subtle">
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-2xl text-sm">
          <Link href={`/help/${slug}`} className="font-medium text-accent hover:text-accent-hover">
            ← {workspace.kbTitle || `${workspace.name} Help Center`}
          </Link>
        </div>
      </div>

      <article className="mx-auto max-w-2xl px-6 py-10">
        {article.section && (
          <p className="text-sm font-medium text-fg-subtle">{article.section.name}</p>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{article.title}</h1>

        <div
          className="prose prose-neutral mt-6 max-w-none text-fg [&_a]:text-accent [&_a:hover]:text-accent-hover [&_code]:rounded [&_code]:bg-bg-inset [&_code]:px-1 [&_code]:py-0.5 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
        />
      </article>
    </div>
  );
}
