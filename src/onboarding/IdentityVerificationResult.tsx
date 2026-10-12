import type { EnvironmentCheckSnapshot } from '@kenshiki/identity-capture';
import type { VerificationSection } from './IdentityVerificationDetail';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ListRow, ListSection, TextRow } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

/** Reached only after workspace revalidates every retained check and the final native attempt. */
export function IdentityVerificationResult({
  result,
  onExit,
  onDetails,
}: Readonly<{
  result: EnvironmentCheckSnapshot;
  onExit: () => void;
  onDetails: (section: VerificationSection) => void;
}>) {
  const consistent =
    result.state === 'completed' &&
    result.location === 'observed' &&
    result.air === 'consistent' &&
    !result.reason;
  return (
    <Page
      title={t('onboarding.result.title')}
      onClose={() => {
        onExit();
        return true;
      }}
      lead={
        <PageLead
          title={t(consistent ? 'onboarding.result.completedTitle' : 'onboarding.result.reviewTitle')}
          description={t('onboarding.result.description')}
        />
      }
      testID="onboarding-verification-result"
    >
      {(['license', 'phone', 'ssn', 'environment'] as const).map((section) => (
        <ListSection key={section}>
          <ListRow
            label={t(`onboarding.review.${section}.title`)}
            status={t(
              section === 'environment' && !consistent
                ? 'onboarding.result.divergent'
                : `onboarding.review.${section}.status`,
            )}
            description={t(
              section === 'environment' && !consistent
                ? 'onboarding.review.environment.review'
                : `onboarding.review.${section}.description`,
            )}
            rowID={`onboarding-review-${section}`}
            onPress={() => onDetails(section)}
          />
        </ListSection>
      ))}
      <ListSection>
        <TextRow text={t('onboarding.result.note')} />
      </ListSection>
      <Action label={t('onboarding.result.close')} testID="onboarding-verification-close" onPress={onExit} />
    </Page>
  );
}
