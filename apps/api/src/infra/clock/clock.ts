import { Global, Injectable, Module } from '@nestjs/common';

/**
 * The current time, injected so services with time rules (sessions, lockout, financial year)
 * can be tested with a fixed clock (testing standard).
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
