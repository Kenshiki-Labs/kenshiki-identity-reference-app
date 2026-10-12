import type { Configuration } from '@kenshiki/identity-capture';
import { t } from '../locales/i18n';
import { SensorSettingsScreen } from '../sensors/SensorScreen';
import { ButtonRow, ListRow, ListSection, TextRow } from '../ui/List';
import type { IdentityWorkspace } from '../app/useIdentityWorkspace';

export function IdentitySettings({
  workspace,
  configuration,
  developerChecks,
  onDeveloperChecks,
}: Readonly<{
  workspace: IdentityWorkspace;
  configuration: Configuration;
  developerChecks: boolean;
  onDeveloperChecks: () => void;
}>) {
  const { result, savedCount, openingResults, openSaved } = workspace.passport;
  const { result: document } = workspace.license;
  const { requestClear, clearing, restoreFailure, clearFailure } = workspace.recovery;
  const savedPassport = !!configuration.results && (!!result || savedCount > 0);
  const blocked = openingResults || clearing || !!restoreFailure || !!clearFailure;
  return (
    <SensorSettingsScreen>
      <ListSection header={t('settings.identityData')} footer={t('settings.reviewSaved')}>
        {openingResults && <TextRow text={t('common.openingSavedResults')} />}
        {!openingResults && restoreFailure && (
          <TextRow text={t('settings.savedUnavailable')} tone="warning" />
        )}
        {!openingResults && !restoreFailure && !document && !savedPassport && (
          <TextRow text={t('settings.noSaved')} />
        )}
        {document && (
          <ListRow
            rowID="settings-license-checks"
            label={t('hub.license.title')}
            disabled={blocked}
            onPress={() => workspace.license.start()}
          />
        )}
        {savedPassport && (
          <ListRow
            rowID="settings-saved-passports"
            label={t('hub.action.openSavedPassportChecks')}
            disabled={blocked}
            onPress={openSaved}
          />
        )}
      </ListSection>
      <ListSection>
        {document && (
          <ButtonRow
            testID="settings-erase-license"
            label={t('hub.action.deleteLicenseScans')}
            destructive
            disabled={blocked}
            onPress={() => requestClear('document')}
          />
        )}
        {savedPassport && (
          <ButtonRow
            testID="settings-erase-passports"
            label={t('hub.action.eraseAll')}
            destructive
            disabled={blocked}
            onPress={() => requestClear('passport')}
          />
        )}
      </ListSection>
      {developerChecks && __DEV__ && (
        <ListSection header={t('settings.developer')}>
          <ListRow
            rowID="open-sdk-checks"
            label={t('hub.action.developerChecks')}
            onPress={onDeveloperChecks}
          />
        </ListSection>
      )}
    </SensorSettingsScreen>
  );
}
