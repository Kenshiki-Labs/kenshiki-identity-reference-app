import { t } from './locales/i18n';
import { SensorSettingsScreen } from './SensorScreen';
import { ListRow, ListSection } from './ui/List';
import { color, symbol } from './ui/tokens.generated';
import type { IdentityWorkspace } from './useIdentityWorkspace';

export function IdentitySettings({
  workspace,
  developerChecks,
  onDeveloperChecks,
}: {
  workspace: IdentityWorkspace;
  developerChecks: boolean;
  onDeveloperChecks: () => void;
}) {
  const { result, savedCount, openingResults, openSaved } = workspace.passport;
  const { result: document } = workspace.license;
  const { requestClear } = workspace.recovery;
  return (
    <SensorSettingsScreen>
      <ListSection header={t('settings.identityData')} footer={t('settings.reviewSaved')} icons>
        {(!!result || savedCount > 0) && (
          <ListRow
            rowID="settings-saved-passports"
            label={t('hub.action.openSavedPassportChecks')}
            icon={{ name: symbol.savedChecks, background: color.swiftGray }}
            disabled={openingResults}
            onPress={openSaved}
          />
        )}
        <ListRow
          rowID="settings-license-checks"
          label={t('hub.license.title')}
          icon={{ name: symbol.license, background: color.swiftBlue }}
          onPress={() => workspace.license.start()}
        />
        {result && (
          <ListRow
            label={t('hub.action.eraseAll')}
            destructive
            chevron={false}
            icon={{ name: symbol.erase, background: color.swiftRed }}
            onPress={() => requestClear('passport')}
          />
        )}
        {document && (
          <ListRow
            label={t('hub.action.deleteLicenseScans')}
            destructive
            chevron={false}
            icon={{ name: symbol.erase, background: color.swiftRed }}
            onPress={() => requestClear('document')}
          />
        )}
      </ListSection>
      {developerChecks && __DEV__ && (
        <ListSection header={t('settings.developer')} icons>
          <ListRow
            rowID="open-sdk-checks"
            label={t('hub.action.developerChecks')}
            icon={{ name: symbol.developer, background: color.swiftGray }}
            onPress={() => onDeveloperChecks()}
          />
        </ListSection>
      )}
    </SensorSettingsScreen>
  );
}
