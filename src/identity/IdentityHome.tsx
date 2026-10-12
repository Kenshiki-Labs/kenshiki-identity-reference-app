import type { Configuration } from '@kenshiki/identity-capture';
import { Text } from 'react-native';
import { isCompleteDocument } from './DocumentFlowController';
import { t } from '../locales/i18n';
import { phoneCheckStopped } from './PhonePolicy';
import { ssnSummary } from './SSNResultDetails';
import { ListRow, ListSection } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import type { IdentityWorkspace } from '../app/useIdentityWorkspace';

const configurationIssues = {
  holderScopeUnreadable: 'hub.configurationIssue',
  liveServicesUnavailable: 'hub.liveServicesUnavailable',
} as const;

export function IdentityHome({
  configuration,
  configurationIssue,
  workspace,
  onWelcome,
  onLicenseResult,
  onPassportResult,
}: Readonly<{
  configuration: Configuration;
  configurationIssue?: 'holderScopeUnreadable' | 'liveServicesUnavailable' | undefined;
  workspace: IdentityWorkspace;
  onWelcome: () => void;
  onLicenseResult: () => void;
  onPassportResult: (focus: 'passport' | 'face') => void;
}>) {
  const { result, openingResults, savedCount } = workspace.passport;
  const { result: document } = workspace.license;
  const { result: ssn, start: openSSN } = workspace.ssn;
  const { result: phone, start: openPhone } = workspace.phone;
  const { restoreFailure, clearFailure } = workspace.recovery;
  const passportReady = !!configuration.trustAnchorsURL;
  const faceReady = !!configuration.embedderURL && !!configuration.detectorURL;
  const blocked = openingResults || !!restoreFailure;
  const passportDisabled = blocked || (!passportReady && !result && !savedCount);
  const faceDisabled =
    blocked ||
    !(result?.comparison || (faceReady && result?.passport.portraitAvailable) || (!result && savedCount > 0));
  const ssnBlocked = workspace.ssn.blocked;
  const phoneDisabled = blocked || !!workspace.phone.blocked;
  const covered = !!clearFailure || !!restoreFailure;
  /** Why a dimmed check cannot open, for the section footer. Nothing while results are opening. */
  function unavailableReasons() {
    if (blocked) return undefined;
    const reasons = [
      passportDisabled ? t('hub.passport.notSetUp') : undefined,
      faceDisabled ? (faceReady ? t('hub.face.needsPassport') : t('hub.face.notSetUp')) : undefined,
    ].filter((reason): reason is string => !!reason);
    return reasons.length ? reasons.join(' ') : undefined;
  }
  function licenseSummary() {
    if (!document) return t('hub.license.start');
    if (!isCompleteDocument(document.document)) return t('hub.license.continueBack');
    const check = workspace.license.checkSnapshot;
    if (check?.failure) return t('hub.license.checkNeedsAttention');
    if (workspace.license.recordAccepted) return t('hub.license.recordMatched');
    if (check?.result?.outcome === 'recordMatched') return t('hub.license.checkNeedsAttention');
    if (check?.result) return t(`documentCheck.outcome.${check.result.outcome}`);
    if (check?.state === 'unanswered') return t('documentCheck.state.unanswered');
    if (check && check.state !== 'notStarted') return t('hub.license.checkNeedsAttention');
    return t('hub.license.captured');
  }
  function passportSummary() {
    if (result) {
      return t('hub.passport.viewResults', {
        givenNames: result.passport.givenNames,
        surname: result.passport.surname,
      });
    }
    if (openingResults) {
      return t('common.openingSavedResults');
    }
    if (savedCount) {
      return t('hub.passport.openSaved');
    }
    return t('hub.passport.start');
  }
  function faceSummary() {
    if (result?.comparison) {
      return t('hub.face.viewResults');
    }
    if (!result && savedCount) {
      return t('hub.face.chooseSaved');
    }
    return t('hub.face.start');
  }
  function ssnStatus() {
    if (ssn?.snapshot.recoveryNeeded) return t('hub.ssn.needsAttention');
    if (ssn?.snapshot.receipt) return t('hub.ssn.viewResult', { summary: ssnSummary(ssn.snapshot.receipt) });
    return t('hub.ssn.start');
  }
  function phoneStatus() {
    if (phone?.snapshot.pending) return t('hub.phone.resume');
    if (!phone?.snapshot.receipt) return t('hub.phone.start');
    return phoneCheckStopped(phone.snapshot.receipt) ? t('hub.phone.stopped') : t('hub.phone.viewResult');
  }
  const saved = !!configuration.results && !!result;
  return (
    <Page
      title={t('hub.title')}
      lead={
        <PageLead title={t('pageLead.identity.title')} description={t('pageLead.identity.description')} />
      }
      testID="identity-hub"
      covered={covered}
    >
      {configurationIssue && (
        <Text style={styles.label} testID="configuration-issue">
          {t(configurationIssues[configurationIssue])}
        </Text>
      )}
      <ListSection header={t('onboarding.eyebrow')}>
        <ListRow
          rowID="open-identity-welcome"
          label={t('onboarding.title')}
          status={t('onboarding.entryDescription')}
          disabled={blocked}
          onPress={onWelcome}
        />
      </ListSection>
      <ListSection header={t('hub.section.individual')} footer={unavailableReasons()}>
        <ListRow
          rowID="open-driver-license"
          label={t('hub.license.title')}
          status={licenseSummary()}
          onPress={onLicenseResult}
        />
        <ListRow
          rowID="open-capture-flow"
          label={t('hub.passport.title')}
          status={passportDisabled && !blocked ? t('hub.notAvailable') : passportSummary()}
          disabled={passportDisabled}
          onPress={() => onPassportResult('passport')}
        />
        <ListRow
          rowID="face-match-card"
          label={t('hub.face.title')}
          status={faceDisabled && !blocked ? t('hub.notAvailable') : faceSummary()}
          disabled={faceDisabled}
          onPress={() => onPassportResult('face')}
        />
        <ListRow
          rowID="open-phone"
          label={t('hub.phone.title')}
          status={workspace.phone.blocked ? t(`prerequisite.${workspace.phone.blocked}`) : phoneStatus()}
          disabled={phoneDisabled}
          onPress={openPhone}
        />
        <ListRow
          rowID="open-ssn"
          label={t('common.socialSecurityNumber')}
          status={ssnBlocked ? t(`prerequisite.${ssnBlocked}`) : ssnStatus()}
          disabled={blocked || !!ssnBlocked}
          onPress={openSSN}
        />
      </ListSection>
      {saved && (
        <ListSection header={t('hub.section.saved')} footer={t('hub.action.savedNotice')}>
          <ListRow
            label={t('hub.action.openSavedPassportChecks')}
            disabled={openingResults}
            onPress={workspace.passport.openSaved}
          />
        </ListSection>
      )}
    </Page>
  );
}
