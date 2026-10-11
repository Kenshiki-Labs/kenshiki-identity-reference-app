import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';

export type DocumentCheckAction =
  | 'check'
  | 'readAgain'
  | 'restore'
  | 'askAgain'
  | 'correct'
  | 'retake'
  | 'none';

/** Presentation follows the native journal, never guesses whether a failed command was dispatched.
 * Restore is local; only a saved unanswered request or retryable answer authorizes askAgain.
 * A reader failure precedes request creation, so retrying check resumes the SDK preparation path.
 */
export function documentCheckAction(snapshot: DocumentCheckSnapshot | undefined): DocumentCheckAction {
  if (!snapshot) return 'restore';
  switch (snapshot.state) {
    case 'notStarted':
      return 'check';
    case 'unanswered':
      return 'askAgain';
    case 'unreadable':
      return 'retake';
    case 'readerUnavailable':
      switch (snapshot.failure) {
        case 'sourceIntegrityFailure':
        case 'authenticityFailed':
        case 'documentNotLive':
        case 'notCameraCapture':
          return 'retake';
        default:
          return 'readAgain';
      }
    case 'unavailable':
      return snapshot.failure === 'notCameraCapture' ? 'retake' : 'restore';
    case 'checked':
      switch (snapshot.result?.outcome) {
        case 'pending':
        case 'unavailable':
          return 'askAgain';
        case 'needsCorrection':
          return 'correct';
        default:
          return 'none';
      }
  }
}
