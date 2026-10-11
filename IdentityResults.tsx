import type { Configuration } from '@kenshiki/identity-capture';
import { Text } from 'react-native';
import { DocumentResult } from './DocumentResult';
import { CaptureResultDetails } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { Action } from './ui/Action';
import { Page } from './ui/Page';
import { styles } from './ui/styles';
import type { IdentityWorkspace } from './useIdentityWorkspace';

export function LicenseResult({
  configuration,
  workspace,
}: Readonly<{
  configuration: Configuration;
  workspace: IdentityWorkspace;
}>) {
  const { result: document, start: startDocument } = workspace.license;
  const { requestClear } = workspace.recovery;
  if (!document) return null;
  return (
    <Page title={t('hub.licenseTitle')}>
      <DocumentResult
        key={document.document.front?.captureID}
        result={document}
        onState={workspace.license.checkChanged}
        onRetake={() => startDocument('front')}
        configured={!!configuration.document?.check}
      >
        <Action
          label={t('license.retake')}
          secondary
          testID="retake-saved-document"
          onPress={() => startDocument('front')}
        />
        <Action
          label={t('hub.action.deleteLicenseScans')}
          destructive
          onPress={() => requestClear('document')}
        />
      </DocumentResult>
    </Page>
  );
}
export function PassportResult({
  configuration,
  workspace,
  focus,
}: Readonly<{
  configuration: Configuration;
  workspace: IdentityWorkspace;
  focus: 'passport' | 'face';
}>) {
  const { result, start } = workspace.passport;
  const { requestClear } = workspace.recovery;
  const faceReady = !!configuration.embedderURL && !!configuration.detectorURL;
  const passportReady = !!configuration.trustAnchorsURL;
  if (!result) return null;
  return (
    <Page title={t('hub.resultsTitle')}>
      <CaptureResultDetails result={result} focus={focus} />
      <Action
        label={result.comparison ? t('passport.action.retakeSelfie') : t('passport.action.compareSelfie')}
        secondary
        disabled={!result.passport.portraitAvailable || !faceReady}
        onPress={() => start('selfie')}
      />
      {!faceReady && <Text style={styles.label}>{t('hub.face.notSetUp')}</Text>}
      <Action
        label={t('passport.action.readChipAgain')}
        secondary
        disabled={!passportReady}
        onPress={() => start('read')}
      />
      <Action label={t('hub.action.clearResults')} destructive onPress={() => requestClear('passport')} />
    </Page>
  );
}
