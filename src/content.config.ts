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
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    draft: z.boolean().default(false),
    series: reference('series').optional(),
    series_order: z.number().optional(),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    width: z.enum(['narrow', 'standard', 'wide', 'full']).default('standard'),
  }),
});

export const collections = { blog, series };
