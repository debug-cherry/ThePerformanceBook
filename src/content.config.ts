import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const series = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/series' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

const blog = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/blog',
    generateId: ({ entry }) => {
      const cleanPath = entry.replace(/\.md$/, '');
      if (cleanPath.endsWith('/index')) {
        return cleanPath.slice(0, -6);
      }
      return cleanPath;
    }
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    draft: z.boolean().default(false),
    series: reference('series').optional(),
    series_order: z.number().optional(),
    quickByte: z.boolean().default(false),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    width: z.enum(['narrow', 'standard', 'wide', 'full']).default('standard'),
    githubRepo: z.string().optional(),
    githubCommits: z.string().optional(),
    githubReleases: z.string().optional(),
    suggestedResources: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        description: z.string().optional(),
      })
    ).optional(),
  }),
});

export const collections = { blog, series };
