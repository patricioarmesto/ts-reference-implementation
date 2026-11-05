import { Router } from 'express'
import {
  CreateTodoInputSchema, Err, ListTodosQuerySchema, TodoIdParamsSchema, UpdateTodoInputSchema,
} from '@repo/shared'
import { asyncHandler, sendResult } from '../../shared/http.js'
import { validationError } from '../../shared/errors.js'
import type { TodosUseCases } from './usecase.js'

export function createTodosController(useCases: TodosUseCases): Router {
  const router = Router()

  router.get('/', asyncHandler(async (req, res) => {
    const query = ListTodosQuerySchema.safeParse(req.query)
    if (!query.success) {
      sendResult(res, Err(validationError('Invalid filter', query.error.flatten())))
      return
    }
    sendResult(res, await useCases.list(query.data))
  }))

  router.post('/', asyncHandler(async (req, res) => {
    const body = CreateTodoInputSchema.safeParse(req.body)
    if (!body.success) {
      sendResult(res, Err(validationError('Invalid todo', body.error.flatten())))
      return
    }
    sendResult(res, await useCases.create(body.data), 201)
  }))

  router.patch('/:id', asyncHandler(async (req, res) => {
    const params = TodoIdParamsSchema.safeParse(req.params)
    const body = UpdateTodoInputSchema.safeParse(req.body)
    if (!params.success || !body.success) {
      sendResult(res, Err(validationError('Invalid update', {
        params: params.success ? undefined : params.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      })))
      return
    }
    sendResult(res, await useCases.setCompleted(params.data.id, body.data))
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const params = TodoIdParamsSchema.safeParse(req.params)
    if (!params.success) {
      sendResult(res, Err(validationError('Invalid id', params.error.flatten())))
      return
    }
    sendResult(res, await useCases.remove(params.data.id))
  }))

  return router
}
