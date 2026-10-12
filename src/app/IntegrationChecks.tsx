import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCapturePreview, IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  IntegrationChecksController,
  type IntegrationChecksState,
  initialIntegrationChecksState,
} from './IntegrationChecksController';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ContentRow, ListSection, TextRow } from '../ui/List';
import { NativeSheet } from '../ui/NativeSheet';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useControllerState } from '../ui/useControllerState';

/** Simulator Debug only. The controller owns diagnostic sessions and isolated test custody. */
export function IntegrationChecks({ configuration }: Readonly<{ configuration: Configuration }>) {
  const [leaving, setLeaving] = useState(false);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const closing = useRef(false);
  const connect = useCallback(
    (publish: (state: IntegrationChecksState) => void) => {
      const controller = new IntegrationChecksController(
        IdentityCaptureSession.create,
        configuration,
        publish,
      );
      controller.open().catch(() => setReleaseFailed(true));
      return { controller, initialState: controller.state, dispose: controller.dispose };
    },
    [configuration],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(
    initialIntegrationChecksState,
    connect,
  );
  const close = async () => {
    if (closing.current) return false;
    closing.current = true;
    setLeaving(true);
    try {
      if (controller) await controller.dispose();
      else cancelStartup();
      return true;
    } catch {
      setReleaseFailed(true);
      return false;
    }
  };
  const needsRecovery = releaseFailed || failed || state.releaseFailed;
  return (
    <Page
      title={t('developer.title')}
      lead={
        <PageLead title={t('pageLead.developer.title')} description={t('pageLead.developer.description')} />
      }
      onClose={close}
      covered={needsRecovery}
      overlay={
        needsRecovery && (
          <NativeSheet title={t('common.checkNeedsAttention')} testID="developer-release-failure">
            <Text accessibilityRole="alert" style={styles.body}>
              {t('common.sessionRecovery')}
            </Text>
          </NativeSheet>
        )
      }
    >
      <ListSection header={t('developer.section.status')}>
        <ContentRow>
          <Text
            style={styles.body}
            testID="sdk-check-status"
            accessibilityLabel={state.status}
            accessibilityLiveRegion="polite"
          >
            {state.status}
          </Text>
        </ContentRow>
        <TextRow text={t('developer.environment')} />
        <Action
          grouped
          label={t('developer.run')}
          onPress={() => controller?.run()}
          disabled={!controller || state.busy || state.opening || leaving || needsRecovery}
          testID="run-sdk-checks"
        />
      </ListSection>
      <ListSection header={t('developer.section.results')}>
        {state.results.map((result) => (
          <TextRow key={result.id} text={result.label} />
        ))}
      </ListSection>
      <ListSection header={t('developer.section.preview')}>
        <TextRow text={t('developer.preview')} />
        <ContentRow>
          <View style={styles.developerPreview}>
            {state.session && (
              <IdentityCapturePreview session={state.session} kind="mrz" style={{ flex: 1 }} />
            )}
          </View>
        </ContentRow>
      </ListSection>
    </Page>
  );
}
