import {
  type CaptureSession,
  type Configuration,
  IdentityCaptureSession,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Settings, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { t } from './locales/i18n';
import { Action } from './ui/Action';
import { Page } from './ui/Page';
import { styles } from './ui/styles';

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
  const [permission, setPermission] = useState<Permission>('location');
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

  const next = () => {
    setFailure(false);
    if (permission === 'location') setPermission('motion');
    else if (permission === 'motion') setPermission('bluetooth');
    else finish().catch(() => setFailure(true));
  };
  return (
    <PermissionPrimer
      board={board}
      permission={permission}
      askedAlways={askedAlways}
      busy={busy}
      failure={failure}
      onNext={next}
      onRequest={() => {
        request(permission).catch(() => setFailure(true));
      }}
      onSettings={() => {
        Linking.openSettings().catch(() => setFailure(true));
      }}
    />
  );
}

function PermissionPrimer({
  board,
  permission,
  askedAlways,
  busy,
  failure,
  onNext,
  onRequest,
  onSettings,
}: {
  board: SensorBoardState | null;
  permission: Permission;
  askedAlways: boolean;
  busy: boolean;
  failure: boolean;
  onNext: () => void;
  onRequest: () => void;
  onSettings: () => void;
}) {
  const { status, granted, approximate, settingsNeeded, whileUsing } = permissionPresentation(
    board,
    permission,
    askedAlways,
  );
  const last = permission === 'bluetooth';
  const proceed = () => {
    if (granted || status === 'unavailable') onNext();
    else if (settingsNeeded) onSettings();
    else onRequest();
  };
  const actionLabel =
    granted || status === 'unavailable'
      ? t(last ? 'firstRun.open' : 'firstRun.next')
      : t(settingsNeeded ? 'firstRun.settings' : 'firstRun.request');
  return (
    <SafeAreaProvider>
      <Page
        key={permission}
        title={t(`firstRun.${permission}.title`)}
        testID="permissions-introduction"
        actions={
          <>
            <Action
              label={actionLabel}
              testID="first-run-primary"
              disabled={busy || !status}
              onPress={proceed}
            />
            {!granted && status !== 'unavailable' && (
              <Action
                label={t('firstRun.notNow')}
                testID="first-run-skip"
                secondary
                disabled={busy}
                onPress={onNext}
              />
            )}
          </>
        }
      >
        <Text style={styles.eyebrow}>
          {t('firstRun.step', { number: permissions.indexOf(permission) + 1, total: permissions.length })}
        </Text>
        <Text style={styles.body}>{t(`firstRun.${permission}.body`)}</Text>
        {granted && (
          <Text style={styles.body}>
            {t(permission === 'location' ? 'firstRun.locationReady' : 'firstRun.allowed')}
          </Text>
        )}
        {status === 'unavailable' && <Text style={styles.label}>{t('firstRun.unavailable')}</Text>}
        {status === 'refused' && <Text style={styles.label}>{t('firstRun.denied')}</Text>}
        {whileUsing && <Text style={styles.label}>{t('firstRun.whileUsing')}</Text>}
        {approximate && <Text style={styles.label}>{t('firstRun.preciseBody')}</Text>}
        {last && <Text style={styles.label}>{t('firstRun.camera')}</Text>}
        {failure && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {t('firstRun.failure')}
          </Text>
        )}
      </Page>
    </SafeAreaProvider>
  );
}

function permissionPresentation(
  board: SensorBoardState | null,
  permission: Permission,
  askedAlways: boolean,
) {
  const status = board?.permissions[permission];
  const granted =
    status === 'given' &&
    (permission !== 'location' || (board?.permissions.always === true && board.permissions.precise));
  const approximate = permission === 'location' && status === 'given' && !board?.permissions.precise;
  const settingsNeeded =
    status === 'refused' ||
    (permission === 'location' && (askedAlways || (board?.permissions.always === true && approximate)));
  const whileUsing = permission === 'location' && status === 'given' && !board?.permissions.always;
  return { status, granted, approximate, settingsNeeded, whileUsing };
}
