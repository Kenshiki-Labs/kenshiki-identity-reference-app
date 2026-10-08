import React from 'react';
import {Text, View} from 'react-native';
import type {SubscriberComparisonResult, SubscriberComparisonFailure} from '@kenshiki/identity-capture';
import {styles} from './IdentityCaptureFlow';

/** Renders the saved reply inside the existing phone result screen; this view sends nothing. */
export function SubscriberResultDetails({result, failure}: {
  result?: SubscriberComparisonResult; failure?: SubscriberComparisonFailure | null;
}) {
  if (!result) return <Text style={styles.body}>{failure === 'outcomeUnknown'
    ? 'Your text was received. The subscriber comparison may have run, but its answer was not received. Opening this result will not run it again.'
    : failure === 'notDispatched'
      ? 'Your text was received. The subscriber comparison was not run.'
      : 'Your text was received. A usable subscriber comparison was not returned.'}</Text>;
  return <View testID="subscriber-result">
    <Row label="Reported outcome" value={{satisfied: 'Required details agree', notSatisfied: 'Some details differ', incomplete: 'Comparison incomplete'}[result.evaluation.status]} />
    <Row label="Compared" value={result.completedAt} />
    <Row label="Required details" value={names(result.evaluation.requiredChecks)} />
    <Row label="Details outside the accepted grades" value={names(result.evaluation.outsidePolicyChecks)} />
    <Row label="Details missing usable evidence" value={names(result.evaluation.incompleteChecks)} />
    {result.checks.map(check => <View key={check.name} style={styles.card}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>{label(check.name)}</Text>
      <Row label="Result" value={label(check.outcome)} />
      <Row label="Submitted" value={check.submitted} />
      <Row label="Compared by provider" value={check.compared} />
      <Row label="Comparison scope" value={label(check.scope)} />
      <Row label="Fields covered" value={names(check.coveredInputs)} />
      <Row label="Reason" value={label(check.reason)} />
    </View>)}
    {result.wholeAddress && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>Whole address</Text>
      <Text style={styles.body}>This combined observation does not fill in missing individual address checks.</Text>
      <Row label="Result" value={label(result.wholeAddress.outcome)} />
      <Row label="Submitted" value={result.wholeAddress.submitted} />
      <Row label="Compared by provider" value={result.wholeAddress.compared} />
      <Row label="Fields covered" value={names(result.wholeAddress.coveredInputs)} />
      <Row label="Coverage basis" value={label(result.wholeAddress.coverageBasis)} />
      <Row label="Reason" value={label(result.wholeAddress.reason)} />
    </View>}
    <Row label="Provider" value={result.provider.providerID} />
    <Row label="Product" value={result.provider.product} />
    <Row label="Record source" value={label(result.source.kind)} />
    <Row label="Source observed" value={result.source.observedAt} />
    <Row label="Source reference" value={result.source.reference} />
  </View>;
}

function Row({label: title, value}: {label: string; value?: string | boolean | null}) {
  const text = value == null || value === '' ? 'Not returned' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value;
  return <View style={styles.detail}><Text style={styles.label}>{title}</Text><Text selectable style={styles.body}>{text}</Text></View>;
}
function names(values: string[]) { return values.map(label).join(', ') || 'None reported'; }
function label(value: string) { return labels[value] ?? value; }
const labels: Record<string, string> = {
  givenName: 'Given name', familyName: 'Family name', birthDate: 'Date of birth', addressLines: 'Street address',
  addressLine1: 'Address line 1', addressLine2: 'Address line 2', city: 'City', region: 'State or region', postalCode: 'Postal code', country: 'Country',
  exactMatch: 'Exact match', highPartialMatch: 'High partial match', partialMatch: 'Partial match', lowPartialMatch: 'Low partial match',
  noMatch: 'Does not match', noData: 'No data', unsupported: 'Unsupported', unavailable: 'Unavailable',
  indeterminate: 'Indeterminate', notRequested: 'Not requested', individualAttribute: 'Individual field',
  combinedAddressLines: 'Address lines together', wholeAddress: 'Whole address', unqualified: 'Not established', notApplicable: 'Not applicable',
  reportedGrade: 'Provider reported this grade', unsupportedField: 'Field unsupported', unsupportedNetwork: 'Network unsupported',
  supplierUnavailable: 'Provider unavailable', notAuthorized: 'Not authorized', omittedResult: 'Result omitted',
  unknownSupplierValue: 'Unrecognized provider value', unqualifiedSemantics: 'Meaning not established', invalidSupplierResponse: 'Invalid provider response',
  qualified: 'Established', unverified: 'Not established', operator: 'Operator', thirdParty: 'Third party', mixed: 'Mixed', unknown: 'Unknown',
};
