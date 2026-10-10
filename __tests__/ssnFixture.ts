import type { SSNVerificationReceipt } from '@kenshiki/identity-capture';

export const ssnBinding = {
  installationID: 'test-installation',
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
    contract_version: 'pulse.ssn.v1',
    operation_id: ssnOperationID,
    profile_version: 'test-five-1',
    request_revision: ssnBinding.documentOperationID,
    completed_at: instant,
    provider: {
      provider_id: 'test',
      product: 'five',
      api_version: '1',
      adapter_version: '1',
      qualification_revision: 'unqualified',
    },
    checks: {
      ssn_issuance: check('ssn_issuance', 'record_presence'),
      death_master_file: {
        ...check('death_master_file', 'unqualified'),
        compared: null,
        outcome: 'indeterminate',
        reason_code: 'comparison_scope_unknown',
      },
      ssn_name_association: check('ssn_name_association', 'grouped_association'),
      ssn_address_association: check('ssn_address_association', 'grouped_association'),
      ssn_phone_association: check('ssn_phone_association', 'grouped_association'),
    },
    evaluation: {
      status: 'incomplete',
      policy_version: 'test-five-1',
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
function check(product: string, scope: 'record_presence' | 'grouped_association' | 'unqualified') {
  return {
    submitted: true,
    execution: 'response_received' as const,
    compared: true,
    outcome: 'match' as const,
    comparison_scope: scope,
    reason_code: 'matched' as const,
    provenance: { product_id: product, api_version: '1', dispatched_at: instant, received_at: instant },
  };
}
