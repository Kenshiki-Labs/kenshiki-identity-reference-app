import {
  type CaptureSession,
  type Configuration,
  IdentityCaptureSession,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, Settings, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { ButtonRow, ListSection, TextRow } from './ui/List';

const completionKey = 'kenshiki.reference.permissionsIntroduction.v1';
const permissions = ['location', 'motion', 'bluetooth'] as const;
type Permission = (typeof permissions)[number];

/** This is an introduction flag, not a saved authorization decision. iOS owns permission state. */
export function FirstRunPermissions({
  configuration,
  enabled,
  children,
}: {
  configuration: Configuration;
  enabled: boolean;
  children: ReactNode;
}) {
  const [completed, setCompleted] = useState(() => !enabled || Settings.get(completionKey) === 'completed');
  if (completed) return children;
  return (
    <PermissionIntroduction
      configuration={configuration}
      onComplete={() => {
        Settings.set({ [completionKey]: 'completed' });
        setCompleted(true);
      }}
    />
  );
}

function PermissionIntroduction({
  configuration,
  onComplete,
}: {
  configuration: Configuration;
  onComplete: () => void;
}) {
  const session = useRef<CaptureSession | null>(null);
  const opening = useRef<Promise<void> | null>(null);
  const working = useRef(false);
  const refreshing = useRef(false);
  const pendingRead = useRef<Promise<void>>(Promise.resolve());
  const [board, setBoard] = useState<SensorBoardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [askedAlways, setAskedAlways] = useState(false);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    let live = true;
    // Status only: no resume, refresh, scan or location fix runs during this introduction.
    opening.current = (async () => {
      if (!configuration.sensors) return;
      const created = await IdentityCaptureSession.create({ sensors: configuration.sensors });
      if (!live) {
        await created.release();
        return;
      }
      session.current = created;
      const status = await created.sensorBoard({ action: 'status' });
      if (live) setBoard(status);
    })().catch(() => {
      if (live) setFailure(true);
    });
    const refresh = () => {
      const current = session.current;
      if (!current || working.current || refreshing.current || AppState.currentState !== 'active') return;
      refreshing.current = true;
      pendingRead.current = current
        .sensorBoard({ action: 'status' })
        .then((status) => {
          if (live) setBoard(status);
        })
        .catch(() => {
          if (live) setFailure(true);
        })
        .finally(() => {
          refreshing.current = false;
        });
    };
    const timer = setInterval(refresh, 750);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      live = false;
      clearInterval(timer);
      subscription.remove();
      const current = session.current;
      session.current = null;
      // Normal completion releases before mounting the app; this handles an interrupted introduction.
      if (current) current.release().catch(() => setFailure(true));
    };
  }, [configuration]);

  async function request(permission: Permission) {
    if (working.current || !session.current) return;
    working.current = true;
    setBusy(true);
    setFailure(false);
    try {
      await pendingRead.current;
      if (permission === 'location' && askedAlways) {
        await Linking.openSettings();
      } else {
        setBoard(
          await session.current.sensorBoard({
            action: 'permission',
            permission: permission === 'location' ? 'always' : permission,
            consent: true,
          }),
        );
        if (permission === 'location') setAskedAlways(true);
      }
    } catch {
      setFailure(true);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function finish() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(false);
    try {
      await opening.current;
      await pendingRead.current;
      await session.current?.release();
      session.current = null;
      onComplete();
    } catch {
      setFailure(true);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} testID="permissions-introduction">
          <Text accessibilityRole="header" style={styles.title}>
            {t('firstRun.title')}
          </Text>
          <Text style={styles.body}>{t('firstRun.intro')}</Text>
          {permissions.map((permission) => {
            const status = board?.permissions[permission];
            const granted =
              status === 'given' && (permission !== 'location' || board?.permissions.always === true);
            const settingsNeeded = status === 'refused' || (permission === 'location' && askedAlways);
            return (
              <ListSection
                key={permission}
                header={t(`firstRun.${permission}.title`)}
                footer={t(`firstRun.${permission}.body`)}
              >
                <ButtonRow
                  label={
                    granted
                      ? t('firstRun.allowed')
                      : settingsNeeded
                        ? t('firstRun.settings')
                        : status === 'unavailable'
                          ? t('firstRun.unavailable')
                          : t('firstRun.allow')
                  }
                  testID={`first-run-${permission}`}
                  disabled={busy || !status || granted || status === 'unavailable'}
                  onPress={() => {
                    request(permission).catch(() => setFailure(true));
                  }}
                />
              </ListSection>
            );
          })}
          {board?.permissions.location === 'given' && !board.permissions.precise ? (
            <ListSection footer={t('firstRun.preciseBody')}>
              <ButtonRow
                label={t('firstRun.precise')}
                testID="first-run-precise"
                onPress={() => {
                  Linking.openSettings().catch(() => setFailure(true));
                }}
              />
            </ListSection>
          ) : null}
          <ListSection footer={t('firstRun.later')}>
            <TextRow text={t('firstRun.camera')} />
          </ListSection>
          {failure ? (
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              {t('firstRun.failure')}
            </Text>
          ) : null}
          <ListSection>
            <ButtonRow
              label={t('firstRun.continue')}
              testID="first-run-continue"
              disabled={busy}
              onPress={() => {
                finish().catch(() => setFailure(true));
              }}
            />
          </ListSection>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
