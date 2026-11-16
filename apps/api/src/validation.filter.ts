import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import type { Response } from 'express';

/** Единая граница для схем query/body, включая parse() внутри сервисов. */
@Catch(ZodError, BadRequestException)
export class ValidationFilter implements ExceptionFilter {
  catch(error: ZodError | BadRequestException, host: ArgumentsHost): void {
    const details = error instanceof BadRequestException ? error.getResponse() : null;
    const message =
      details && typeof details === 'object' && 'message' in details
        ? details.message
        : 'Некорректные данные запроса';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(400)
      .json({
        statusCode: 400,
        error: 'Bad Request',
        message,
        errors:
          error instanceof ZodError
            ? error.issues.map(({ path, code, message }) => ({ path, code, message }))
            : [{ path: [], code: 'invalid_request', message }],
      });
  }
}
