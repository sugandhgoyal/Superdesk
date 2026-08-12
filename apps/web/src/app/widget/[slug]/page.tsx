import { WidgetApp } from '@/components/widget/WidgetApp';

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WidgetApp workspaceSlug={slug} />;
}
