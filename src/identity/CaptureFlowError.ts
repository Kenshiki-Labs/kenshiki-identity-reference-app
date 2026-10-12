import type { CaptureErrorCode } from '@kenshiki/identity-capture';

/** Local flow failures preserve the SDK error code used by presentation and recovery. */
export class CaptureFlowError extends Error {
  constructor(readonly code: CaptureErrorCode) {
    super(code);
    this.name = 'CaptureFlowError';
  }
}
