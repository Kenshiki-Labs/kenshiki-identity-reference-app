import type { DocumentCheckResult } from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { t } from './locales/i18n';
import { styles } from './ui/styles';

const names: Record<string, string> = {
  aamva_name_comparison: t('license.result.name'),
  aamva_birthdate_comparison: t('documentCheck.field.birthDate'),
  aamva_identification_number_comparison: t('documentCheck.field.documentNumber'),
  aamva_address_comparison: t('license.result.address'),
  aamva_issue_date_comparison: t('documentCheck.field.issueDate'),
  aamva_expiration_date_comparison: t('documentCheck.field.expiryDate'),
};
const statuses: Record<string, string> = {
  passed: t('documentCheck.checkStatus.passed'),
  failed: t('documentCheck.checkStatus.failed'),
  pending: t('documentCheck.checkStatus.pending'),
  not_applicable: t('documentCheck.checkStatus.notApplicable'),
};
const members: Record<string, string> = {
  'name-first-match': t('documentCheck.field.givenName'),
  'name-middle-match': t('documentCheck.field.middleName'),
  'name-last-match': t('documentCheck.field.familyName'),
  'match-result': t('documentCheck.comparisonResult'),
};
const matches: Record<string, string> = {
  full: t('documentCheck.comparison.full'),
  partial: t('documentCheck.comparison.partial'),
  none: t('documentCheck.comparison.none'),
  missing: t('documentCheck.comparison.missing'),
};
const label = (labels: Record<string, string>, value: string) =>
  Object.hasOwn(labels, value) ? labels[value] : value;

/** Mirrors the Swift readout's lossless metadata display. This does not decide field acceptance:
 * an overall pass and a check's pass never manufacture missing per-field comparison evidence. */
function metadata(json: string | null | undefined): { key: string; value: string }[] {
  if (json == null) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]: [string, unknown]) => ({
          key,
          value: typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
        }));
    }
  } catch {
    // Preserve malformed provider metadata as text; never discard evidence or crash the result screen.
    return opaqueMetadata(json);
  }
  return opaqueMetadata(json);
}

function opaqueMetadata(json: string) {
  return [{ key: t('documentCheck.metadata'), value: json }];
}

export function DocumentProviderChecks({
  checks,
}: Readonly<{ checks: DocumentCheckResult['providerChecks'] }>) {
  if (!checks.length) return <Text style={styles.body}>{t('documentCheck.noProviderChecks')}</Text>;
  return (
    <View testID="document-provider-checks">
      <Text accessibilityRole="header" style={styles.label}>
        {t('documentCheck.checksHeading')}
      </Text>
      <Text style={styles.body}>{t('documentCheck.checksNote')}</Text>
      {checks.map((check, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: Provider entries have no ID and may repeat; these read-only rows have no local state.
          key={`${index}:${check.name}`}
          style={styles.detail}
          testID={`document-provider-check-${index}`}
        >
          <Text style={styles.label}>{label(names, check.name)}</Text>
          <Text style={styles.body}>{label(statuses, check.status)}</Text>
          {check.reasons.map((reason, reasonIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Preserve repeated provider reasons in their reported order.
            <Text key={`${reasonIndex}:${reason}`} style={styles.body}>
              {reason}
            </Text>
          ))}
          {metadata(check.metadataJSON).map(({ key, value }) => (
            <View key={key}>
              <Text style={styles.label}>{label(members, key)}</Text>
              <Text style={styles.body}>{Object.hasOwn(members, key) ? label(matches, value) : value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
