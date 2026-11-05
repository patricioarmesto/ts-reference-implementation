import { z } from 'zod'

export const SeedInputSchema = z.object({
  todos: z.array(z.string().trim().min(1).max(200)).optional(),
})
export type SeedInput = z.infer<typeof SeedInputSchema>

export const SeedOutputSchema = z.object({ id: z.string().min(1) })
export type SeedOutput = z.infer<typeof SeedOutputSchema>
