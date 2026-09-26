import 'reflect-metadata';
import { bootstrap, describeBootFailure } from './bootstrap.js';

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${describeBootFailure(error)}\n`);
  process.exit(1);
});
