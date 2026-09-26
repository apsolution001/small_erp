import { type GstinLookupResponse } from '@ekaro/contracts';
import { ServiceUnavailableError } from '../../../common/errors/domain-error.js';
import { type GspProvider } from './gsp-provider.js';

/**
 * A GSTIN lookup whose failure (portal down, timeout, adapter error) is a 503
 * `SERVICE_UNAVAILABLE` for the client, not a 500. The adapter's error is kept as the cause for
 * the log only.
 */
export async function lookupGstinOrUnavailable(
  gsp: GspProvider,
  gstin: string,
): Promise<GstinLookupResponse> {
  try {
    return await gsp.lookupGstin(gstin);
  } catch (error) {
    throw new ServiceUnavailableError(
      'SERVICE_UNAVAILABLE',
      'The GST portal could not be reached. Try again in a few minutes.',
      { cause: error },
    );
  }
}
