import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Filtre global (ARCHITECTURE.md section 20/21 : logs + gestion des erreurs).
 * Toute reponse d'erreur suit la meme enveloppe JSON, qu'elle vienne d'une HttpException
 * connue ou d'une exception inattendue -- qui est alors journalisee avec sa pile complete
 * mais jamais renvoyee au client (pas de fuite de details internes).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;
    const message = isHttpException
      ? typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as { message?: string | string[] })?.message ?? exception.message)
      : 'Erreur interne inattendue';

    const body: ErrorBody = {
      statusCode,
      error: HttpStatus[statusCode] ?? 'Error',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (!isHttpException) {
      this.logger.error({ err: exception, path: request.url }, 'Exception non geree');
    } else if (statusCode >= 500) {
      this.logger.error({ err: exception, path: request.url }, 'Erreur serveur');
    } else {
      this.logger.warn({ path: request.url, statusCode }, message as string);
    }

    response.status(statusCode).json(body);
  }
}
