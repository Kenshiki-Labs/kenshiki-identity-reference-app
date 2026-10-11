// Responsibility: Determines whether the reference UI can offer phone and SSN checks.
// Control: Requires matching document capture hashes and a completed phone snapshot; these are presentation gates.
// Native counterpart: Native phone and SSN providers must independently resolve and revalidate bound evidence.
// Specification: RFC-0002 §§4.2–4.3; capability-evidence-and-assurance-plan §§3.3, 3.5–3.6.

import type {
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
  PhoneCheckSnapshot,
} from '@kenshiki/identity-capture';
import { phoneCheckStopped } from './PhonePolicy';

/** A restored native answer must describe one of the current capture's exact originals.
 * Captured fields and provider configuration alone are not an accepted document check. */
export function phonePrerequisite(
  configuration: Configuration,
  document: DocumentObservation | undefined,
  checked: DocumentCheckSnapshot | undefined,
): 'document' | 'service' | undefined {
  if (
    !document ||
    !checked ||
    checked.state !== 'checked' ||
    checked.failure ||
    checked.result?.outcome !== 'recordMatched' ||
    !checked.result.operationID ||
    ![document.front, document.back].some(
      (side) => side && side.captureID === checked.captureID && side.sha256 === checked.sourceSHA256,
    )
  )
    return 'document';
  if (!configuration.phone?.checkedDocumentID) return 'service';
  return undefined;
}

/** Presentation gates only. Native providers must resolve and revalidate the bound document
 * and phone receipt before dispatch; a visible card or JavaScript snapshot grants no authority. */
export function ssnPrerequisite(
  configuration: Configuration,
  phone: PhoneCheckSnapshot | undefined,
  documentReady = false,
): 'document' | 'phone' | 'service' | undefined {
  if (!documentReady || !configuration.phone?.checkedDocumentID) return 'document';
  if (
    !phone?.receipt ||
    phone.pending ||
    phone.busy ||
    phone.stage !== 'completed' ||
    phone.failure ||
    phoneCheckStopped(phone.receipt)
  )
    return 'phone';
  if (!configuration.ssn) return 'service';
  return undefined;
}
