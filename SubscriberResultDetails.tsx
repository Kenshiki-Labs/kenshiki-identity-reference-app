import type { SubscriberComparisonFailure, SubscriberComparisonResult } from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { styles } from './ui/styles';

/** Each reason the comparison did not return a usable answer. Possession stays confirmed. */
const failures: Record<SubscriberComparisonFailure, string> = {
  busy: t('subscriber.failure.busy'),
  consentRequired: t('subscriber.failure.consentRequired'),
  invalidRequest: t('subscriber.failure.invalidRequest'),
  contextChanged: t('subscriber.failure.contextChanged'),
  storageUnavailable: t('subscriber.failure.storageUnavailable'),
  notConfigured: t('subscriber.failure.notConfigured'),
  unauthorized: t('subscriber.failure.unauthorized'),
  forbidden: t('subscriber.failure.forbidden'),
  profileChanged: t('subscriber.failure.profileChanged'),
  expiredRequest: t('subscriber.failure.expiredRequest'),
  invalidEvidence: t('subscriber.failure.invalidEvidence'),
  rateLimited: t('subscriber.failure.rateLimited'),
  capabilityUnavailable: t('subscriber.failure.capabilityUnavailable'),
  outcomeUnknown: t('subscriber.failure.outcomeUnknown'),
  invalidResponse: t('subscriber.failure.invalidResponse'),
};

/** Renders the saved reply inside the existing phone result screen; this view sends nothing. */
export function SubscriberResultDetails({
  result,
  failure,
}: Readonly<{
  result?: SubscriberComparisonResult | undefined;
  failure?: (SubscriberComparisonFailure | null) | undefined;
}>) {
  if (!result)
    return <Text style={styles.body}>{failure ? failures[failure] : t('subscriber.noResult')}</Text>;
  return (
    <View testID="subscriber-result">
      <Row label={t('common.reportedOutcome')} value={evaluationStatus[result.evaluation.status]} />
      <Row label={t('common.compared')} value={formatMoment(result.completedAt)} />
      <Row label={t('subscriber.requiredDetails')} value={names(result.evaluation.requiredChecks)} />
      <Row label={t('subscriber.outsidePolicy')} value={names(result.evaluation.outsidePolicyChecks)} />
      <Row label={t('subscriber.incompleteDetails')} value={names(result.evaluation.incompleteChecks)} />
      {result.checks.map((check) => (
        <View key={check.name} style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {label(check.name)}
          </Text>
          <Row label={t('subscriber.result')} value={label(check.outcome)} />
          <Row label={t('subscriber.submitted')} value={check.submitted} />
          <Row label={t('subscriber.comparedByCarrier')} value={check.compared} />
          <Row label={t('subscriber.scope')} value={label(check.scope)} />
          <Row label={t('subscriber.fieldsCovered')} value={names(check.coveredInputs)} />
          <Row label={t('subscriber.reason')} value={label(check.reason)} />
        </View>
      ))}
      {result.wholeAddress && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('subscriber.wholeAddressTitle')}
          </Text>
          <Text style={styles.body}>{t('subscriber.wholeAddressNotice')}</Text>
          <Row label={t('subscriber.result')} value={label(result.wholeAddress.outcome)} />
          <Row label={t('subscriber.submitted')} value={result.wholeAddress.submitted} />
          <Row label={t('subscriber.comparedByCarrier')} value={result.wholeAddress.compared} />
          <Row label={t('subscriber.fieldsCovered')} value={names(result.wholeAddress.coveredInputs)} />
          <Row label={t('subscriber.coverageBasis')} value={label(result.wholeAddress.coverageBasis)} />
          <Row label={t('subscriber.reason')} value={label(result.wholeAddress.reason)} />
        </View>
      )}
      <Row label={t('subscriber.recordSource')} value={label(result.source.kind)} />
      <Row
        label={t('subscriber.sourceObserved')}
        value={result.source.observedAt ? formatMoment(result.source.observedAt) : null}
      />
    </View>
  );
}

function Row({
  label: title,
  value,
}: Readonly<{ label: string; value: string | boolean | null | undefined }>) {
  const text =
    value == null || value === ''
      ? t('common.notReturned')
      : typeof value === 'boolean'
        ? value
          ? t('common.yes')
          : t('common.no')
        : value;
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}
function names(values: string[]) {
  return values.map(label).join(t('common.listSeparator')) || t('common.noneReported');
}
function label(value: string) {
  return labels[value] ?? t('subscriber.label.other');
}
const evaluationStatus = {
  satisfied: t('subscriber.status.satisfied'),
  notSatisfied: t('subscriber.status.notSatisfied'),
  incomplete: t('subscriber.status.incomplete'),
};
const labels: Record<string, string> = {
  givenName: t('subscriber.label.givenName'),
  familyName: t('subscriber.label.familyName'),
  birthDate: t('subscriber.label.birthDate'),
  addressLines: t('subscriber.label.addressLines'),
  addressLine1: t('subscriber.label.addressLine1'),
  addressLine2: t('subscriber.label.addressLine2'),
  city: t('subscriber.label.city'),
  region: t('subscriber.label.region'),
  postalCode: t('subscriber.label.postalCode'),
  country: t('subscriber.label.country'),
  exactMatch: t('subscriber.label.exactMatch'),
  highPartialMatch: t('subscriber.label.highPartialMatch'),
  partialMatch: t('subscriber.label.partialMatch'),
  lowPartialMatch: t('subscriber.label.lowPartialMatch'),
  noMatch: t('subscriber.label.noMatch'),
  noData: t('subscriber.label.noData'),
  unsupported: t('subscriber.label.unsupported'),
  unavailable: t('subscriber.label.unavailable'),
  indeterminate: t('subscriber.label.indeterminate'),
  notRequested: t('subscriber.label.notRequested'),
  individualAttribute: t('subscriber.label.individualAttribute'),
  combinedAddressLines: t('subscriber.label.combinedAddressLines'),
  wholeAddress: t('subscriber.label.wholeAddress'),
  unqualified: t('subscriber.label.unqualified'),
  notApplicable: t('subscriber.label.notApplicable'),
  reportedGrade: t('subscriber.label.reportedGrade'),
  unsupportedField: t('subscriber.label.unsupportedField'),
  unsupportedNetwork: t('subscriber.label.unsupportedNetwork'),
  supplierUnavailable: t('subscriber.label.supplierUnavailable'),
  notAuthorized: t('subscriber.label.notAuthorized'),
  omittedResult: t('subscriber.label.omittedResult'),
  unknownSupplierValue: t('subscriber.label.unknownSupplierValue'),
  unqualifiedSemantics: t('subscriber.label.unqualifiedSemantics'),
  invalidSupplierResponse: t('subscriber.label.invalidSupplierResponse'),
  qualified: t('subscriber.label.qualified'),
  unverified: t('subscriber.label.unverified'),
  operator: t('subscriber.label.operator'),
  thirdParty: t('subscriber.label.thirdParty'),
  mixed: t('subscriber.label.mixed'),
  unknown: t('subscriber.label.unknown'),
};
