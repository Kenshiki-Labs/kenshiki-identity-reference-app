import type { CaptureErrorCode, DocumentCheckFailureCode } from '@kenshiki/identity-capture';
import type { ErrorText } from '../app/HolderText';
import { t } from '../locales/i18n';

export const labels = {
  recordMatched: t('documentCheck.outcome.recordMatched'),
  recordNotMatched: t('documentCheck.outcome.recordNotMatched'),
  pending: t('documentCheck.outcome.pending'),
  unavailable: t('documentCheck.outcome.unavailable'),
  needsCorrection: t('documentCheck.outcome.needsCorrection'),
  inconclusive: t('documentCheck.outcome.inconclusive'),
};
/** Text shared by the snapshot's failure field and command rejections. */
const checkFailures = {
  readerUnbound: t('documentCheck.failure.readerUnbound'),
  requestRejected: t('documentCheck.failure.requestRejected'),
  serviceUnavailable: t('documentCheck.failure.serviceUnavailable'),
  replyRejected: t('documentCheck.failure.replyRejected'),
  requestConflict: t('documentCheck.failure.requestConflict'),
  nothingToAskAgain: t('documentCheck.failure.nothingToAskAgain'),
  correctionNotRequested: t('documentCheck.failure.correctionNotRequested'),
  busy: t('documentCheck.failure.busy'),
  cancelled: t('documentCheck.failure.cancelled'),
} satisfies Partial<Record<Extract<DocumentCheckFailureCode, CaptureErrorCode>, string>>;
/** `DocumentCheckSnapshot.failure` has its own closed vocabulary. */
export const snapshotFailures: Record<DocumentCheckFailureCode, string> = {
  ...checkFailures,
  missingPreparedDocument: t('documentCheck.failure.missingPreparedDocument'),
  sourceIntegrityFailure: t('documentCheck.failure.sourceIntegrityFailure'),
  analysisNotCompleted: t('documentCheck.failure.analysisNotCompleted'),
  fullPhotoAnalysisNotCompleted: t('documentCheck.failure.fullPhotoAnalysisNotCompleted'),
  observationsRejected: t('documentCheck.failure.observationsRejected'),
  retentionFailed: t('documentCheck.failure.retentionFailed'),
  engineUnavailable: t('documentCheck.failure.engineUnavailable'),
  authenticityFailed: t('documentCheck.failure.authenticityFailed'),
  documentNotLive: t('documentCheck.failure.documentNotLive'),
  notCameraCapture: t('documentCheck.failure.notCameraCapture'),
  cancelled: t('documentCheck.failure.cancelled'),
  custodyUnavailable: t('documentCheck.failure.custodyUnavailable'),
};
/** Command rejections, by code. */
export const failures: ErrorText = {
  ...checkFailures,
  consentRequired: t('documentCheck.failure.consentRequired'),
  documentCheckNotConfigured: t('documentCheck.failure.documentCheckNotConfigured'),
  documentFrontRequired: t('documentCheck.failure.documentFrontRequired'),
  invalidArgument: t('documentCheck.failure.invalidArgument'),
  documentCustodyFailed: t('documentCheck.failure.documentCustodyFailed'),
  sessionUnavailable: t('documentCheck.failure.sessionUnavailable'),
};
