import { defineCollection, reference } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const notes = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/notes' }),
  schema: z.object({
    title: z.string().trim().min(1),
    description: z.string().default(''),
    date: z.iso.date(),
    category: z.string().default('笔记'),
    sample: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string().trim().min(1),
    description: z.string().default(''),
    category: z.string().default('项目'),
    date: z.iso.date(),
    status: z
      .enum(['active', 'paused', 'complete', 'archived'])
      .default('active'),
    url: z.url({ protocol: /^https?$/ }).optional(),
    repository: z.url({ protocol: /^https?$/ }).optional(),
    featured: z.boolean().default(false),
    order: z.number().int().default(0),
    draft: z.boolean().default(false),
  }),
});

const updates = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/updates' }),
  schema: z.object({
    title: z.string().trim().min(1),
    date: z.iso.date(),
    items: z.array(z.string().trim().min(1)).default([]),
    project: reference('projects').optional(),
    draft: z.boolean().default(false),
  }),
});

const books = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/books' }),
  schema: z.object({
    title: z.string().trim().min(1),
    author: z.string().default(''),
    sample: z.boolean().default(false),
    draft: z.boolean().default(false),
    order: z.number().int().default(0),
  }),
});

export const collections = { notes, projects, updates, books };
