import type { Configuration } from '@kenshiki/identity-capture';
import { Text } from 'react-native';
import { isCompleteDocument } from './DocumentFlowController';
import { documentName } from './DriverLicenseFlow';
import { t } from './locales/i18n';
import { phoneCheckStopped } from './PhonePolicy';
import { ssnSummary } from './SSNFlow';
import { ListRow, ListSection } from './ui/List';
import { Page } from './ui/Page';
import { styles } from './ui/styles';
import { color, symbol } from './ui/tokens.generated';
import type { IdentityWorkspace } from './useIdentityWorkspace';

export function IdentityHome({
  configuration,
  configurationIssue,
  workspace,
  onLicenseResult,
  onPassportResult,
}: Readonly<{
  configuration: Configuration;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
  workspace: IdentityWorkspace;
  onLicenseResult: () => void;
  onPassportResult: (focus: 'passport' | 'face') => void;
}>) {
  const { result, start, openingResults, savedCount } = workspace.passport;
  const { result: document, start: startDocument } = workspace.license;
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
  const phoneDisabled = blocked || !configuration.phone;
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
    return isCompleteDocument(document.document)
      ? t('hub.license.viewResults', { name: documentName(document.document) })
      : t('hub.license.continueBack');
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
    <Page title={t('hub.title')} testID="identity-hub" covered={covered}>
      {configurationIssue === 'holderScopeUnreadable' && (
        <Text style={styles.label} testID="configuration-issue">
          {t('hub.configurationIssue')}
        </Text>
      )}
      <ListSection header={t('hub.section.checks')} footer={unavailableReasons()} icons>
        <ListRow
          rowID="open-driver-license"
          label={t('hub.license.title')}
          status={licenseSummary()}
          icon={{ name: symbol.license, background: color.swiftBlue }}
          onPress={() =>
            document && isCompleteDocument(document.document) ? onLicenseResult() : startDocument()
          }
        />
        <ListRow
          rowID="open-capture-flow"
          label={t('hub.passport.title')}
          status={passportDisabled && !blocked ? t('hub.notAvailable') : passportSummary()}
          icon={{ name: symbol.passport, background: color.swiftIndigo }}
          disabled={passportDisabled}
          onPress={() => {
            if (result) onPassportResult('passport');
            else start();
          }}
        />
        <ListRow
          rowID="face-match-card"
          label={t('hub.face.title')}
          status={faceDisabled && !blocked ? t('hub.notAvailable') : faceSummary()}
          icon={{ name: symbol.face, background: color.swiftGreen }}
          disabled={faceDisabled}
          onPress={() => {
            if (result?.comparison) onPassportResult('face');
            else start(result ? 'selfie' : undefined);
          }}
        />
        <ListRow
          rowID="open-phone"
          label={t('hub.phone.title')}
          status={phoneDisabled ? t('prerequisite.document') : phoneStatus()}
          icon={{ name: symbol.phone, background: color.swiftTeal }}
          disabled={phoneDisabled}
          onPress={openPhone}
        />
        <ListRow
          rowID="open-ssn"
          label={t('common.socialSecurityNumber')}
          status={ssnBlocked ? t(`prerequisite.${ssnBlocked}`) : ssnStatus()}
          icon={{ name: symbol.ssn, background: color.swiftOrange }}
          disabled={blocked || !!ssnBlocked}
          onPress={openSSN}
        />
      </ListSection>
      {saved && (
        <ListSection header={t('hub.section.saved')} footer={t('hub.action.savedNotice')} icons>
          <ListRow
            label={t('hub.action.openSavedPassportChecks')}
            icon={{ name: symbol.savedChecks, background: color.swiftGray }}
            disabled={openingResults}
            onPress={workspace.passport.openSaved}
          />
        </ListSection>
      )}
    </Page>
  );
}
