import type {
  DocumentCheckSnapshot,
  DocumentFaceSnapshot,
  EnvironmentCheckSnapshot,
} from '@kenshiki/identity-capture';
import { useRef, useState } from 'react';
import { labels as documentOutcomes } from '../identity/DocumentCheckText';
import { documentCustodyPresentation } from '../identity/DocumentCustodyPresentation';
import type { SavedDocumentCapture } from '../identity/DocumentFlowController';
import { environmentAirText } from './EnvironmentCheckText';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import type { SavedPhoneCheck } from '../identity/PhoneFlowController';
import { PhoneResultDetails } from '../identity/PhoneResultDetails';
import type { SavedSSNCheck } from '../identity/SSNFlowController';
import { SSNResultDetails } from '../identity/SSNResultDetails';
import { Action } from '../ui/Action';
import { ListSection, TextRow, ValueRow } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

export type VerificationSection = 'license' | 'phone' | 'ssn' | 'environment';
export type VerificationReview = {
  document: SavedDocumentCapture;
  checked: DocumentCheckSnapshot;
  face: DocumentFaceSnapshot;
  phone: SavedPhoneCheck;
  ssn: SavedSSNCheck;
  environment: EnvironmentCheckSnapshot;
};

/** Retained results only. The owning workspace keeps all sessions; this page never starts a check. */
export function IdentityVerificationDetail({
  section,
  review,
}: Readonly<{
  section: VerificationSection;
  review: VerificationReview;
}>) {
  return (
    <Page
      header="native"
      lead={
        <PageLead
          title={t(`onboarding.review.${section}.title`)}
          description={t(
            section === 'environment' && review.environment.air === 'divergent'
              ? 'onboarding.review.environment.review'
              : `onboarding.review.${section}.description`,
          )}
        />
      }
      title={t(`onboarding.result.${section}`)}
      testID={`verification-detail-${section}`}
    >
      {section === 'license' && <LicenseDetail review={review} />}
      {section === 'phone' &&
        (review.phone.snapshot.receipt ? (
          <PhoneResultDetails receipt={review.phone.snapshot.receipt} session={review.phone.session} />
        ) : (
          <TextRow text={t('fusionUI.notAvailable')} />
        ))}
      {section === 'ssn' &&
        (review.ssn.snapshot.receipt ? (
          <SSNResultDetails receipt={review.ssn.snapshot.receipt} session={review.ssn.session} />
        ) : (
          <TextRow text={t('fusionUI.notAvailable')} />
        ))}
      {section === 'environment' && <EnvironmentDetail result={review.environment} />}
    </Page>
  );
}

function LicenseDetail({ review }: Readonly<{ review: VerificationReview }>) {
  const pending = useRef(false);
  const [opening, setOpening] = useState(false);
  async function details() {
    if (pending.current) return;
    pending.current = true;
    setOpening(true);
    try {
      await review.document.session.documentDetails(documentCustodyPresentation());
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }
  const face = review.face;
  return (
    <>
      <ListSection header={t('onboarding.result.license')}>
        <ValueRow
          label={t('common.reportedOutcome')}
          value={
            review.checked.result
              ? documentOutcomes[review.checked.result.outcome]
              : t('fusionUI.notAvailable')
          }
        />
        <ValueRow
          label={t('documentCustody.strings.checked')}
          value={
            review.checked.checkedAt ? formatMoment(review.checked.checkedAt) : t('fusionUI.notAvailable')
          }
        />
        <Action
          grouped
          label={t('license.result.showAll')}
          testID="verification-license-native-details"
          onPress={details}
          disabled={opening}
        />
      </ListSection>
      <ListSection header={t('onboarding.result.face')}>
        <ValueRow label={t('common.reportedOutcome')} value={faceOutcomeText(face)} />
        {face.state === 'completed' && (
          <ValueRow label={t('common.compared')} value={formatMoment(face.result.completedAt)} />
        )}
      </ListSection>
    </>
  );
}

function EnvironmentDetail({ result }: Readonly<{ result: EnvironmentCheckSnapshot }>) {
  return (
    <ListSection header={t('onboarding.result.environment')}>
      <ValueRow
        label={t('documentCustody.strings.checked')}
        value={result.checkedAt ? formatMoment(result.checkedAt) : t('fusionUI.notAvailable')}
      />
      <ValueRow
        label={t('onboarding.result.location')}
        value={t(
          result.location === 'observed'
            ? 'onboarding.environment.locationObserved'
            : 'onboarding.environment.locationUnavailable',
        )}
      />
      <ValueRow label={t('onboarding.result.air')} value={environmentAirText(result.air)} />
      <TextRow text={t('onboarding.environment.note')} />
    </ListSection>
  );
}

function faceOutcomeText(face: DocumentFaceSnapshot): string {
  if (face.state !== 'completed') return t('face.notTaken');
  if (face.result.outcome === 'pass') return t('face.outcome.pass');
  if (face.result.outcome === 'fail') return t('face.outcome.fail');
  return t('face.outcome.manualReview');
}
