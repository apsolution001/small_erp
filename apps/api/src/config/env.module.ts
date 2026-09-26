import { type DynamicModule, Global, Inject, Module } from '@nestjs/common';
import { type Env } from './env.js';

/** Injection token for the parsed {@link Env}. */
export const ENV = Symbol('ENV');

/** `@InjectEnv() private readonly env: Env` */
export const InjectEnv = (): ParameterDecorator => Inject(ENV);

/** Provides the already-validated environment to the whole app. */
@Global()
@Module({})
export class EnvModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
