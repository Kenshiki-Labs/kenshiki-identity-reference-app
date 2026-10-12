import type { Configuration } from '@kenshiki/identity-capture';
import { Text } from 'react-native';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { NativeSheet, useConfirmation } from '../ui/NativeSheet';
import { styles } from '../ui/styles';
import type { IdentityWorkspace } from '../app/useIdentityWorkspace';

export function IdentityRecovery({
  configuration,
  workspace,
}: Readonly<{
  configuration: Configuration;
  workspace: IdentityWorkspace;
}>) {
  const { openingResults } = workspace.passport;
  const { restoreFailure, clearFailure, clearing, confirmingClear, requestClear, clear } = workspace.recovery;
  useConfirmation(
    confirmingClear
      ? {
          key: confirmingClear,
          title: confirmingClear === 'document' ? t('hub.clear.licenseTitle') : t('hub.clear.passportTitle'),
          message: confirmingClear === 'document' ? t('hub.clear.licenseBody') : t('hub.clear.passportBody'),
          confirm:
            confirmingClear === 'document' ? t('hub.clear.deleteLicenseScans') : t('hub.action.clearResults'),
          keep: t('hub.clear.keep'),
          onConfirm: workspace.recovery.confirmClear,
          onKeep: workspace.recovery.cancelClear,
        }
      : undefined,
  );
  return (
    <>
      {restoreFailure && !clearFailure && (
        <NativeSheet title={t('hub.restore.title')} testID="restore-bottom-sheet">
          <Text style={styles.body}>{t('hub.restore.body', { reason: restoreFailure })}</Text>
          <Action
            label={t('hub.restore.reopen')}
            disabled={openingResults}
            onPress={workspace.recovery.retryRestore}
          />
          {configuration.results && (
            <Action
              label={t('hub.restore.erase')}
              destructive
              disabled={openingResults}
              testID="erase-unreadable-results"
              onPress={() => requestClear('passport')}
            />
          )}
        </NativeSheet>
      )}
      {clearFailure && (
        <NativeSheet title={t('hub.clear.failedTitle')} testID="clear-bottom-sheet">
          <Text style={styles.body}>{clearFailure.message}</Text>
          <Action
            label={t('common.tryAgain')}
            onPress={() => clear(clearFailure.target)}
            disabled={clearing}
          />
          <Action
            label={t('hub.clear.keep')}
            secondary
            onPress={workspace.recovery.dismissClearFailure}
            disabled={clearing}
          />
        </NativeSheet>
      )}
    </>
  );
}
