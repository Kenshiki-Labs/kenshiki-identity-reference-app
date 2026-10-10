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
import { createControllerCustody, type IdentityCustody } from './ui/ControllerCustody';
import { Page } from './ui/Page';
import { styles } from './ui/styles';

const completionKey = 'kenshiki.reference.permissionsIntroduction.v1';
const permissions = ['location', 'motion', 'bluetooth'] as const;
type Permission = (typeof permissions)[number];
type PermissionOwner = {
  active: boolean;
  session?: CaptureSession;
  opening: Promise<void>;
  pendingRead: Promise<void>;
  releasing?: Promise<void>;
  working: boolean;
  refreshing: boolean;
};

function releaseSession(owner: PermissionOwner): Promise<void> {
  const session = owner.session;
  if (!session) return Promise.resolve();
  owner.releasing ??= new Promise<void>((resolve) => {
    resolve(session.release());
  });
  return owner.releasing;
}

async function closeOwner(owner: PermissionOwner): Promise<void> {
  const release = releaseSession(owner);
  await Promise.allSettled([owner.opening, owner.pendingRead, release]);
  await release;
  await releaseSession(owner);
}

/** Completion may publish only after this exact owner's cleanup, while it is still mounted. */
async function finishOwner(owner: PermissionOwner, custody: IdentityCustody): Promise<boolean> {
  await owner.opening;
  await owner.pendingRead;
  if (!owner.active) return false;
  custody.releasing = Promise.all([custody.releasing, releaseSession(owner)]);
  custody.releasing.catch(custody.reportFailure);
  await custody.releasing;
  if (!owner.active) return false;
  delete owner.session;
  owner.active = false;
  return true;
}

/** This is an introduction flag, not a saved authorization decision. iOS owns permission state. */
export function FirstRunPermissions({
  configuration,
  enabled,
  children,
}: Readonly<{
  configuration: Configuration;
  enabled: boolean;
  children: ReactNode;
}>) {
  const [completed, setCompleted] = useState(() => !enabled || Settings.get(completionKey) === 'completed');
  const [owner, setOwner] = useState({ configuration, revision: 0 });
  const [custody] = useState(createControllerCustody);
  if (owner.configuration !== configuration) {
    setOwner({ configuration, revision: owner.revision + 1 });
  }
  if (completed) return children;
  return (
    <PermissionIntroduction
      key={owner.revision}
      configuration={configuration}
      custody={custody}
      onComplete={() => {
        Settings.set({ [completionKey]: 'completed' });
        setCompleted(true);
      }}
    />
  );
}

function PermissionIntroduction({
  configuration,
  custody,
  onComplete,
}: Readonly<{
  configuration: Configuration;
  custody: IdentityCustody;
  onComplete: () => void;
}>) {
  const sessionOwner = useRef<PermissionOwner | undefined>(undefined);
  const [board, setBoard] = useState<SensorBoardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [askedAlways, setAskedAlways] = useState(false);
  const [permission, setPermission] = useState<Permission>('location');
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    const owner: PermissionOwner = {
      active: true,
      working: false,
      refreshing: false,
      opening: Promise.resolve(),
      pendingRead: Promise.resolve(),
    };
    sessionOwner.current = owner;
    const previousRelease = custody.releasing;
    // Status only: no resume, refresh, scan or location fix runs during this introduction.
    owner.opening = (async () => {
      await previousRelease;
      if (!owner.active || !configuration.sensors) return;
      const created = await IdentityCaptureSession.create({ sensors: configuration.sensors });
      // This owner retains a late handle until its cleanup has released it.
      owner.session = created;
      if (!owner.active) return;
      const status = await created.sensorBoard({ action: 'status' });
      if (owner.active) setBoard(status);
    })().catch(() => {
      if (owner.active) setFailure(true);
    });
    const refresh = () => {
      const current = owner.session;
      if (
        !owner.active ||
        !current ||
        owner.working ||
        owner.refreshing ||
        AppState.currentState !== 'active'
      )
        return;
      owner.refreshing = true;
      owner.pendingRead = current
        .sensorBoard({ action: 'status' })
        .then((status) => {
          if (owner.active) setBoard(status);
        })
        .catch(() => {
          if (owner.active) setFailure(true);
        })
        .finally(() => {
          owner.refreshing = false;
        });
    };
    const timer = setInterval(refresh, 750);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      owner.active = false;
      clearInterval(timer);
      subscription.remove();
      // Revoke an acquired handle immediately, and also own creation that has not returned yet.
      // Opening captured the previous barrier, so cleanup never waits on itself.
      custody.releasing = Promise.all([custody.releasing, closeOwner(owner)]);
      custody.releasing.catch(custody.reportFailure);
    };
  }, [configuration, custody]);

  async function request(permission: Permission) {
    const owner = sessionOwner.current;
    const current = owner?.session;
    if (!owner?.active || owner.working || !current) return;
    owner.working = true;
    setBusy(true);
    setFailure(false);
    try {
      await owner.pendingRead;
      if (!owner.active) return;
      if (permission === 'location' && askedAlways) {
        await Linking.openSettings();
        return;
      }
      const status = await current.sensorBoard({
        action: 'permission',
        permission: permission === 'location' ? 'always' : permission,
        consent: true,
      });
      publishPermission(owner, permission, status);
    } catch {
      if (owner.active) setFailure(true);
    } finally {
      owner.working = false;
      if (owner.active) setBusy(false);
    }
  }

  function publishPermission(owner: PermissionOwner, permission: Permission, status: SensorBoardState) {
    if (!owner.active) return;
    setBoard(status);
    if (permission === 'location') setAskedAlways(true);
  }

  async function finish() {
    const owner = sessionOwner.current;
    if (!owner?.active || owner.working) return;
    owner.working = true;
    setBusy(true);
    setFailure(false);
    try {
      if (await finishOwner(owner, custody)) onComplete();
    } catch {
      if (owner.active) setFailure(true);
    } finally {
      owner.working = false;
      if (owner.active) setBusy(false);
    }
  }

  const next = () => {
    if (!sessionOwner.current?.active) return;
    setFailure(false);
    if (permission === 'location') setPermission('motion');
    else if (permission === 'motion') setPermission('bluetooth');
    else finish().catch(custody.reportFailure);
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
        request(permission).catch(custody.reportFailure);
      }}
      onSettings={() => {
        const owner = sessionOwner.current;
        Linking.openSettings().catch(() => {
          if (owner?.active) setFailure(true);
        });
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
}: Readonly<{
  board: SensorBoardState | null;
  permission: Permission;
  askedAlways: boolean;
  busy: boolean;
  failure: boolean;
  onNext: () => void;
  onRequest: () => void;
  onSettings: () => void;
}>) {
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
