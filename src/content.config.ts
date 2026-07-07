import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    draft: z.boolean().default(false),
    series: z.string().optional(),
    series_order: z.number().optional(),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
  }),
});

export const collections = { blog };
