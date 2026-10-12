import type { SSNSessionSnapshot, SSNVerificationReceipt } from '@kenshiki/identity-capture';

export const ssnBinding = {
  enrollmentID: '11111111-1111-4111-8111-111111111111',
  documentOperationID: '22222222-2222-4222-8222-222222222222',
  phoneChallengeID: '33333333-3333-4333-8333-333333333333',
};
export const ssnOperationID = '44444444-4444-4444-8444-444444444444';
const instant = '2026-10-07T20:00:00Z';
export const ssnReceipt: SSNVerificationReceipt = {
  operationID: ssnOperationID,
  binding: ssnBinding,
  checkedAt: instant,
  reportKind: 'fiveChecks',
  issuance: 'issued',
  reportedOutcome: 'unavailable',
  replayed: false,
  fiveChecks: {
    checks: {
      ssn_issuance: check('record_presence'),
      death_master_file: {
        ...check('unqualified'),
        compared: null,
        outcome: 'indeterminate',
        reason_code: 'comparison_scope_unknown',
      },
      ssn_name_association: check('grouped_association'),
      ssn_address_association: check('grouped_association'),
      ssn_phone_association: check('grouped_association'),
    },
    evaluation: {
      status: 'incomplete',
      required_checks: [
        'ssn_issuance',
        'death_master_file',
        'ssn_name_association',
        'ssn_address_association',
        'ssn_phone_association',
      ],
      unsatisfied_checks: [],
      incomplete_checks: ['death_master_file'],
    },
  },
};
function check(scope: 'record_presence' | 'grouped_association' | 'unqualified') {
  return {
    submitted: true,
    execution: 'response_received' as const,
    compared: true,
    outcome: 'match' as const,
    comparison_scope: scope,
    reason_code: 'matched' as const,
  };
}

const positiveReport = ssnReceipt.fiveChecks;
if (!positiveReport) throw new Error('missingFiveCheckFixture');
export const ssnSatisfiedReceipt: SSNVerificationReceipt = {
  ...ssnReceipt,
  reportedOutcome: 'affirmative',
  fiveChecks: {
    checks: {
      ...positiveReport.checks,
      death_master_file: { ...check('record_presence'), outcome: 'mismatch', reason_code: 'mismatched' },
    },
    evaluation: {
      status: 'satisfied',
      required_checks: [...positiveReport.evaluation.required_checks],
      unsatisfied_checks: [],
      incomplete_checks: [],
    },
  },
};
export const ssnCompletedSnapshot: SSNSessionSnapshot = {
  state: 'completed',
  attempt: { operationID: ssnOperationID },
  receipt: ssnSatisfiedReceipt,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
