import { computeGstinChecksum } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { ServiceUnavailableError } from '../../../common/errors/domain-error.js';
import { toProblemDetails } from '../../../common/errors/problem-details.filter.js';
import { type GspProvider } from './gsp-provider.js';
import { GstinController } from './gstin.controller.js';
import { MockGspProvider } from './mock-gsp.provider.js';

const GSTIN = `27AAPCU0939F1Z${computeGstinChecksum('27AAPCU0939F1Z')}`;

describe('GstinController', () => {
  it('returns the registration from the GSP', async () => {
    const gsp = new MockGspProvider();
    const controller = new GstinController(gsp);
    expect(await controller.lookup({ gstin: GSTIN })).toEqual(await gsp.lookupGstin(GSTIN));
  });

  it('maps a GSP failure to 503 SERVICE_UNAVAILABLE, never a 500', async () => {
    const down: GspProvider = {
      lookupGstin: () => Promise.reject(new Error('connect ETIMEDOUT gsp.example:443')),
    };
    const failure = await new GstinController(down)
      .lookup({ gstin: GSTIN })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableError);
    expect(toProblemDetails(failure)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(toProblemDetails(failure))).not.toContain('ETIMEDOUT');
  });
});
