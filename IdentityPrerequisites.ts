import type { Configuration, PhoneCheckSnapshot } from '@kenshiki/identity-capture';
import { phoneCheckStopped } from './PhonePolicy';

/** Presentation gates only. Native providers must resolve and revalidate the bound document
 * and phone receipt before dispatch; a visible card or JavaScript snapshot grants no authority. */
export function ssnPrerequisite(
  configuration: Configuration,
  phone: PhoneCheckSnapshot | undefined,
): 'document' | 'phone' | 'service' | undefined {
  if (!configuration.phone?.checkedDocumentID) return 'document';
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
