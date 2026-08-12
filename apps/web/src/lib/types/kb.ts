export type AdminArticleSummary = {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
  updatedAt: string;
  viewCount: number;
};

export type AdminSection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  articles: AdminArticleSummary[];
};

export type AdminArticleFull = {
  id: string;
  workspaceId: string;
  sectionId: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  bodyMarkdown: string | null;
  bodyHtml: string;
  bodyText: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  authorId: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
};
