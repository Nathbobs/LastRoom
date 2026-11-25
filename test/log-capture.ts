import type { TestingModuleBuilder } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { buildLoggerParams } from '../src/common/logger.config.js';
import type { LogLevel } from '../src/config/env.validation.js';

export interface LogLine {
  level: number;
  time: string;
  msg?: string;
  requestId?: string;
  context?: string;
  [field: string]: unknown;
}

/**
 * Collects the app's pino output in memory, using the production logger config
 * with only the destination swapped. Pass `capture.override` to createTestApp.
 *
 * Caveat: nestjs-pino keeps ONE pino-http instance per process, built by the
 * first app that logs. Vitest runs each test file in its own module graph, so
 * a file that uses LogCapture must create its apps only through it.
 */
export class LogCapture {
  readonly raw: string[] = [];
  readonly lines: LogLine[] = [];

  readonly stream: DestinationStream = {
    write: (chunk: string) => {
      this.raw.push(chunk);
      this.lines.push(JSON.parse(chunk) as LogLine);
    },
  };

  constructor(private readonly level: LogLevel = 'debug') {}

  override = (builder: TestingModuleBuilder): TestingModuleBuilder =>
    builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(buildLoggerParams(this.level, this.stream));

  forRequest(requestId: string): LogLine[] {
    return this.lines.filter((l) => l.requestId === requestId);
  }

  /** Every captured byte, for "this must never appear" checks. */
  text(): string {
    return this.raw.join('');
  }

  /**
   * The "request completed" line is written on the response's finish event,
   * which can land just after the client has the response. Poll briefly.
   */
  async waitFor(
    predicate: (line: LogLine) => boolean,
    timeoutMs = 1000,
  ): Promise<LogLine> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.lines.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error('expected log line was not written in time');
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
