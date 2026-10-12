import type { Configuration } from '@kenshiki/identity-capture';
import { isCompleteDocument } from './DocumentFlowController';
import { DocumentResult } from './DocumentResult';
import { CaptureResultDetails } from './IdentityCaptureFlow';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ListSection, TextRow } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import type { IdentityWorkspace } from '../app/useIdentityWorkspace';

export function LicenseResult({
  configuration,
  workspace,
}: Readonly<{
  configuration: Configuration;
  workspace: IdentityWorkspace;
}>) {
  const { result: document, start: startDocument } = workspace.license;
  const { requestClear } = workspace.recovery;
  if (!document || !isCompleteDocument(document.document))
    return (
      <Page
        lead={
          <PageLead title={t('pageLead.license.title')} description={t('pageLead.license.description')} />
        }
        title={t('hub.licenseTitle')}
      >
        <ListSection>
          <Action
            grouped
            label={t('hub.license.start')}
            onPress={() => startDocument(document ? 'back' : undefined)}
            testID="start-license-capture"
          />
        </ListSection>
      </Page>
    );
  return (
    <Page
      lead={<PageLead title={t('pageLead.license.title')} description={t('pageLead.license.description')} />}
      title={t('hub.licenseTitle')}
    >
      <DocumentResult
        key={document.document.front?.captureID}
        result={document}
        onState={workspace.license.checkChanged}
        onRetake={() => startDocument('front')}
        configured={!!configuration.document?.check}
        onDelete={() => requestClear('document')}
      />
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
  const lead =
    focus === 'face' ? (
      <PageLead title={t('pageLead.face.title')} description={t('pageLead.face.description')} />
    ) : (
      <PageLead title={t('pageLead.passport.title')} description={t('pageLead.passport.description')} />
    );
  if (!result) {
    const startAction = (
      <Action
        grouped
        label={t('hub.passport.start')}
        disabled={!passportReady}
        onPress={() => start()}
        testID="start-passport-capture"
      />
    );
    return (
      <Page lead={lead} title={t('hub.passport.title')}>
        <ListSection>{startAction}</ListSection>
      </Page>
    );
  }
  const readChip = (
    <Action
      key="read"
      grouped
      label={t('passport.action.readChipAgain')}
      secondary
      disabled={!passportReady}
      onPress={() => start('read')}
    />
  );
  const selfie = (
    <Action
      key="selfie"
      grouped
      label={result.comparison ? t('passport.action.retakeSelfie') : t('passport.action.compareSelfie')}
      secondary
      disabled={!result.passport.portraitAvailable || !faceReady}
      onPress={() => start('selfie')}
    />
  );
  const actions = [
    ...(focus === 'passport' ? [readChip, selfie] : [selfie, readChip]),
    !faceReady && <TextRow key="faceSetup" text={t('hub.face.notSetUp')} />,
    <Action
      key="delete"
      grouped
      label={t('hub.action.clearResults')}
      destructive
      onPress={() => requestClear('passport')}
    />,
  ];
  return (
    <Page lead={lead} title={t('hub.resultsTitle')}>
      <CaptureResultDetails result={result} focus={focus} />
      <ListSection>{actions}</ListSection>
    </Page>
  );
}
