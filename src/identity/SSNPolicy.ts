import type { SSNSessionSnapshot, SSNVerificationReceipt } from '@kenshiki/identity-capture';

const checks = [
  'ssn_issuance',
  'death_master_file',
  'ssn_name_association',
  'ssn_address_association',
  'ssn_phone_association',
] as const;

/** Presentation gate only. Native custody independently validates current document and phone binding. */
export function ssnReceiptSatisfied(receipt: SSNVerificationReceipt): boolean {
  const report = receipt.fiveChecks;
  if (
    receipt.reportKind !== 'fiveChecks' ||
    receipt.reportedOutcome !== 'affirmative' ||
    receipt.issuance !== 'issued' ||
    report?.evaluation.status !== 'satisfied' ||
    report.evaluation.unsatisfied_checks.length ||
    report.evaluation.incomplete_checks.length ||
    new Set(report.evaluation.required_checks).size !== checks.length
  )
    return false;
  return checks.every((name) => {
    const check = report.checks[name];
    return (
      report.evaluation.required_checks.includes(name) &&
      check.submitted &&
      check.execution === 'response_received' &&
      check.compared === true &&
      check.comparison_scope !== 'unqualified' &&
      check.outcome === (name === 'death_master_file' ? 'mismatch' : 'match')
    );
  });
}
export function ssnCheckComplete(snapshot: SSNSessionSnapshot | undefined): boolean {
  return (
    !!snapshot &&
    (snapshot.state === 'completed' || snapshot.state === 'ready') &&
    !snapshot.busy &&
    !snapshot.failure &&
    !snapshot.recoveryNeeded &&
    !!snapshot.receipt &&
    snapshot.attempt?.operationID === snapshot.receipt.operationID &&
    ssnReceiptSatisfied(snapshot.receipt)
  );
}
