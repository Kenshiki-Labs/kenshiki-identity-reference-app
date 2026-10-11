import type { CaptureErrorCode, DocumentCheckFailureCode } from '@kenshiki/identity-capture';
import type { ErrorText } from './HolderText';
import { t } from './locales/i18n';

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
const fieldNames: Record<string, string> = {
  givenNames: t('passport.field.givenNames'),
  fullName: t('license.field.DAA'),
  country: t('license.field.DCG'),
  // WorkerDocumentChecker preserves plan.aamva wire keys in submittedFields.
  // Keep provider field names intact; only their display labels are translated.
  'name-first': t('documentCheck.field.givenName'),
  'name-middle': t('documentCheck.field.middleName'),
  'name-last': t('documentCheck.field.familyName'),
  birthdate: t('documentCheck.field.birthDate'),
  'identification-number': t('documentCheck.field.documentNumber'),
  'expiration-date': t('documentCheck.field.expiryDate'),
  'issue-date': t('documentCheck.field.issueDate'),
  'address-street-1': t('documentCheck.field.addressLine1'),
  'address-street-2': t('documentCheck.field.addressLine2'),
  'address-city': t('documentCheck.field.city'),
  'address-subdivision': t('documentCheck.field.region'),
  'address-postal-code': t('documentCheck.field.postalCode'),
  'issuing-authority': t('documentCheck.field.issuingState'),
  'country-code': t('license.field.DCG'),
  givenName: t('documentCheck.field.givenName'),
  familyName: t('documentCheck.field.familyName'),
  middleName: t('documentCheck.field.middleName'),
  birthDate: t('documentCheck.field.birthDate'),
  documentNumber: t('documentCheck.field.documentNumber'),
  expiryDate: t('documentCheck.field.expiryDate'),
  issueDate: t('documentCheck.field.issueDate'),
  addressLine1: t('documentCheck.field.addressLine1'),
  addressLine2: t('documentCheck.field.addressLine2'),
  city: t('documentCheck.field.city'),
  region: t('documentCheck.field.region'),
  postalCode: t('documentCheck.field.postalCode'),
  issuingState: t('documentCheck.field.issuingState'),
};
export const fieldLabel = (field: string) =>
  Object.hasOwn(fieldNames, field) ? fieldNames[field] : t('license.result.unknownField', { code: field });
export const correctionText: Record<string, string> = {
  required: t('documentCheck.correction.required'),
  mismatch: t('documentCheck.correction.mismatch'),
  invalid: t('documentCheck.correction.invalid'),
};
