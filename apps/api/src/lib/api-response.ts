/**
 * Standard API envelope for all JSON responses.
 * Shape: { success, message, data }
 */
import type { FastifyReply } from 'fastify'

export type ApiEnvelope<T = unknown> = {
  success: boolean
  message: string
  data: T | null
}

export function apiSuccess<T>(message: string, data: T): ApiEnvelope<T> {
  return { success: true, message, data }
}

export function apiFailure(message: string, data: Record<string, unknown> | null = null): ApiEnvelope {
  return { success: false, message, data }
}

export function sendSuccess<T>(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  data: T,
): FastifyReply {
  return reply.status(statusCode).send(apiSuccess(message, data)) as FastifyReply
}

export function sendFailure(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  data: Record<string, unknown> | null = null,
): FastifyReply {
  return reply.status(statusCode).send(apiFailure(message, data)) as FastifyReply
}
