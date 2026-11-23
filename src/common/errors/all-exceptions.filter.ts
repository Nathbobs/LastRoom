import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException, ErrorCode, ErrorDetails } from './app-exception.js';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetails;
    requestId: string | undefined;
  };
}

interface Mapped {
  status: number;
  code: ErrorCode;
  message: string;
  details: ErrorDetails;
}

/**
 * The single place that shapes error responses. Everything thrown anywhere
 * ends up as { error: { code, message, details, requestId } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const mapped = mapException(exception);
    if (mapped.status >= 500 && mapped.code === ErrorCode.INTERNAL_ERROR) {
      // Log the real error server-side; the client only gets a generic message.
      this.logger.error(
        `Unhandled error on ${req.method} ${req.path} (requestId=${req.requestId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
        requestId: req.requestId,
      },
    };
    res.status(mapped.status).json(body);
  }
}

export function mapException(exception: unknown): Mapped {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  // Nest's own HTTP errors, e.g. unknown route (404) or malformed JSON body (400).
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code: codeForStatus(status),
      message: exception.message,
      details: {},
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
    details: {},
  };
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
      return ErrorCode.VALIDATION_ERROR;
    case 401:
    case 403:
      return ErrorCode.UNAUTHORIZED;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.INVALID_STATE;
    case 501:
      return ErrorCode.NOT_IMPLEMENTED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}
