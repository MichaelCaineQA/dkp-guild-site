import { z } from 'zod';

export const RULES_SLUGS = ['guild-rules', 'site-rules'] as const;
export type RulesSlug = (typeof RULES_SLUGS)[number];
export const RULES_TITLES: Record<RulesSlug, string> = {
  'guild-rules': 'Правила гильдии',
  'site-rules': 'Правила пользования сайтом',
};
export const rulesSlugSchema = z.enum(RULES_SLUGS);
export const updateRulesSchema = z
  .object({
    contentMd: z
      .string()
      .min(1)
      .max(20_000)
      .refine((value) => value.trim().length > 0),
    expectedVersion: z.number().int().positive(),
    comment: z.string().trim().min(3).max(500),
  })
  .strict();
export const restoreRulesSchema = z
  .object({
    sourceVersion: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    comment: z.string().trim().min(3).max(500),
  })
  .strict();

export interface RulesPageDto {
  slug: RulesSlug;
  title: string;
  contentMd: string;
  version: number;
  updatedAt: string;
}
export interface RulesVersionDto {
  version: number;
  contentMd: string;
  createdAt: string;
}
export type RulesVersionSummary = Omit<RulesVersionDto, 'contentMd'>;
