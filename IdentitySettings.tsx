import { t } from './locales/i18n';
import { SensorSettingsScreen } from './SensorScreen';
import { ListRow, ListSection, TextRow } from './ui/List';
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
  const { result } = workspace.passport;
  const { result: document } = workspace.license;
  const { requestClear } = workspace.recovery;
  const erasable = !!result || !!document;
  return (
    <SensorSettingsScreen>
      <ListSection header={t('settings.identityData')} footer={t('hub.action.savedNotice')} icons>
        {!erasable && <TextRow text={t('settings.nothingSaved')} />}
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
