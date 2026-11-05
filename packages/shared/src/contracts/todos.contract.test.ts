import { describe, expect, it } from 'vitest'
import { CreateTodoInputSchema, ListTodosQuerySchema } from './todos.contract.js'

describe('todos contracts', () => {
  it('trims a valid title', () => {
    expect(CreateTodoInputSchema.parse({ title: '  Buy milk  ' }).title).toBe('Buy milk')
  })

  it('rejects a whitespace-only title', () => {
    expect(CreateTodoInputSchema.safeParse({ title: '   ' }).success).toBe(false)
  })

  it('rejects titles over 200 characters', () => {
    expect(CreateTodoInputSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('defaults the filter to all', () => {
    expect(ListTodosQuerySchema.parse({}).filter).toBe('all')
  })

  it('rejects an unknown filter', () => {
    expect(ListTodosQuerySchema.safeParse({ filter: 'later' }).success).toBe(false)
  })
})
