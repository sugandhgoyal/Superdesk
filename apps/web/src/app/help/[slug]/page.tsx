import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPublicKbHome } from '@/lib/kb';
import { KbSearchBox } from '@/components/kb/KbSearchBox';
import { Card } from '@/components/ui';

// Overrides RootLayout's dashboard-wide `noindex` — a help center is exactly
// the kind of page that should turn up in search results.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicKbHome(slug);
  if (!data) return {};
  return {
    title: data.workspace.kbTitle || `${data.workspace.name} Help Center`,
    description: data.workspace.kbDescription ?? undefined,
    robots: { index: true, follow: true },
  };
}

export default async function KbHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicKbHome(slug);
  if (!data) notFound();

  const { workspace, sections, uncategorized } = data;
  const totalArticles =
    sections.reduce((n, s) => n + s.articles.length, 0) + uncategorized.length;

  return (
    <div className="min-h-full bg-bg-subtle">
      <div className="border-b border-border bg-surface px-6 py-14">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            {workspace.kbTitle || `${workspace.name} Help Center`}
          </h1>
          {workspace.kbDescription && (
            <p className="mt-2 text-fg-muted">{workspace.kbDescription}</p>
          )}
          <div className="mt-6">
            <KbSearchBox workspaceSlug={slug} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {totalArticles === 0 ? (
          <p className="py-12 text-center text-sm text-fg-subtle">
            No articles published yet.
          </p>
        ) : (
          <div className="space-y-8">
            {sections
              .filter((s) => s.articles.length > 0)
              .map((section) => (
                <Card key={section.id} className="p-5">
                  <h2 className="text-base font-semibold text-fg">{section.name}</h2>
                  {section.description && (
                    <p className="mt-0.5 text-sm text-fg-subtle">{section.description}</p>
                  )}
                  <ul className="mt-3 divide-y divide-border">
                    {section.articles.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/help/${slug}/${a.slug}`}
                          className="block py-2.5 text-sm font-medium text-accent hover:text-accent-hover"
                        >
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}

            {uncategorized.length > 0 && (
              <Card className="p-5">
                <h2 className="text-base font-semibold text-fg">More articles</h2>
                <ul className="mt-3 divide-y divide-border">
                  {uncategorized.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${slug}/${a.slug}`}
                        className="block py-2.5 text-sm font-medium text-accent hover:text-accent-hover"
                      >
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
