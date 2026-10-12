import type { Configuration, SensorBoardState } from '@kenshiki/identity-capture';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { t } from '../locales/i18n';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';
import { SensorExplanation } from './SensorBoardDocuments';
import { type BoardActions, locationRows, useSecondClock, weatherRows } from './SensorBoardLocation';
import {
  callActivityRows,
  connectivityRows,
  note,
  Row,
  Section,
  signalRows,
  signalSummary,
  warning,
} from './SensorBoardRows';
import { SensorSettings } from './SensorBoardSettings';
import {
  copy,
  failureText,
  hasDocumentation,
  moment,
  pages,
  permissioned,
  plain,
  prefix,
  type SensorPage,
  title,
} from './SensorPresentation';
import { ListRow, ListSection, TextRow } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { useControllerState } from '../ui/useControllerState';

type SensorSessionValue = {
  state: SensorBoardPresentation;
  failure: string | null;
  setFailure: (message: string | null) => void;
  perform: BoardActions['perform'];
};
const closed: SensorBoardPresentation = { board: null, busy: false, failure: null, sessionId: null };
const SensorSessionContext = createContext<SensorSessionValue>({
  state: closed,
  failure: null,
  setFailure: () => {},
  perform: () => {},
});

export function useSensorSession() {
  return useContext(SensorSessionContext);
}

/** Owns the one sensor board session while any sensor screen is open. The board, its detail pages
 * and its settings are separate screens that share it; leaving the last of them releases it, and
 * opening the board again starts a new session. */
export function SensorSession({
  configuration,
  open,
  children,
}: Readonly<{
  configuration: Configuration;
  open: boolean;
  children: ReactNode;
}>) {
  const currentController = useRef<SensorBoardController | undefined>(undefined);
  const [reportedFailure, setReportedFailure] = useState<{
    controller: SensorBoardController;
    message: string;
  }>();
  const connect = useCallback(
    (publish: (state: SensorBoardPresentation) => void) => {
      if (!open) return;
      const active = new SensorBoardController(configuration, publish);
      currentController.current = active;
      const setActive = (running: boolean) => {
        active.setActive(running).catch(() => {
          if (currentController.current === active)
            setReportedFailure({ controller: active, message: t('sensors.failure.activity') });
        });
      };
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'inactive') return;
        setActive(next === 'active');
      });
      // Custody can delay this connection past a background transition. Seed activity at
      // acquisition time, before open can resume collection; later inactive prompts keep it.
      setActive(AppState.currentState === 'active');
      active.open().catch(() => {
        if (currentController.current === active)
          setReportedFailure({ controller: active, message: t('sensors.failure.open') });
      });
      return {
        controller: active,
        initialState: closed,
        dispose: () => {
          currentController.current = undefined;
          subscription.remove();
          return active.dispose();
        },
      };
    },
    [configuration, open],
  );
  const { controller, state, failed } = useControllerState(closed, connect);
  const failure = failed
    ? t('common.sessionRecovery')
    : reportedFailure && reportedFailure.controller === controller
      ? reportedFailure.message
      : null;
  // An old screen or request may complete after its session has been replaced.
  const setFailure = (message: string | null) => {
    if (!controller || currentController.current !== controller) return;
    setReportedFailure(message ? { controller, message } : undefined);
  };
  const perform: BoardActions['perform'] = (request) => {
    if (!controller || currentController.current !== controller) return;
    setFailure(null);
    controller.perform(request).catch(() => setFailure(t('sensors.failure.request')));
  };
  return (
    <SensorSessionContext.Provider value={{ state, failure, setFailure, perform }}>
      {children}
    </SensorSessionContext.Provider>
  );
}

/** The sensor overview: collection state, then readings grouped by permission requirements. */
export function SensorBoardScreen({ onOpenPage }: Readonly<{ onOpenPage: (page: SensorPage) => void }>) {
  const { state } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll
      lead={<PageLead title={t('pageLead.sensors.title')} description={t('pageLead.sensors.description')} />}
      title={copy('tab.sensors.title')}
      testID="sensor-screen"
    >
      {board ? (
        <>
          <ListSection>
            {board.reading?.deviceSurface.simulator ? note(copy('sensorGroup.notice.simulator')) : null}
            {board.permissions.motion !== 'given' ? warning(copy('sensorGroup.notice.motion')) : null}
          </ListSection>
          <ListSection>
            <ListRow
              label={title('status')}
              status={collectionSummary(board, state.busy)}
              onPress={() => onOpenPage('status')}
            />
          </ListSection>
          {[false, true].map((requiresPermission) => (
            <ListSection
              key={String(requiresPermission)}
              header={copy(requiresPermission ? 'sensorGroup.permissioned' : 'sensorGroup.free')}
              footer={copy(requiresPermission ? 'sensorGroup.permissioned.note' : 'sensorGroup.free.note')}
            >
              {pages
                .filter((page) => page !== 'status' && permissioned(page) === requiresPermission)
                .map((page) => (
                  <ListRow
                    key={page}
                    label={title(page)}
                    status={boardSummary(board, page)}
                    onPress={() => onOpenPage(page)}
                  />
                ))}
            </ListSection>
          ))}
        </>
      ) : null}
    </SensorScroll>
  );
}

// L2 owns readings and interpretation; the native stack opens API references on L3.
export function SensorDetailScreen({
  page,
  onOpenDocumentation,
}: Readonly<{ page: SensorPage; onOpenDocumentation: () => void }>) {
  const { state, perform } = useContext(SensorSessionContext);
  const board = state.board;
  const now = useSecondClock();
  return (
    <SensorScroll
      lead={<PageLead title={title(page)} description={copy(`meaning.${page}`)} />}
      title={title(page)}
      testID="sensor-detail"
    >
      {board ? (
        <Section section={prefix(page)} heading={false}>
          {pageRows(page, { board, busy: state.busy, perform }, state.sessionId, now)}
        </Section>
      ) : null}
      <SensorExplanation page={page} />
      {hasDocumentation(page) ? (
        <ListSection>
          <ListRow label={t('sensors.docs.open')} onPress={onOpenDocumentation} />
        </ListSection>
      ) : null}
    </SensorScroll>
  );
}

/** Preferences and data actions precede the diagnostic information. */
export function SensorSettingsScreen({ children }: Readonly<{ children?: ReactNode }>) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll
      lead={
        <PageLead title={t('pageLead.settings.title')} description={t('pageLead.settings.description')} />
      }
      title={copy('tab.settings.title')}
      testID="sensor-settings"
    >
      {board ? (
        <SensorSettings board={board} busy={state.busy} perform={perform} onFailure={setFailure}>
          {children}
        </SensorSettings>
      ) : (
        children
      )}
    </SensorScroll>
  );
}

/** What every sensor screen shows above its own sections: a failure, or that the board is still
 * opening. */
function SensorScroll({
  lead,
  title,
  testID,
  children,
}: Readonly<{
  lead: ReactNode;
  title: string;
  testID: string;
  children: ReactNode;
}>) {
  const { state, failure } = useContext(SensorSessionContext);
  const shown = failure || state.failure;
  return (
    <Page title={title} testID={testID} lead={lead}>
      <ListSection>
        {shown ? <TextRow text={shown} tone="warning" alert /> : null}
        {state.board || shown ? null : <TextRow text={t('sensors.opening')} />}
      </ListSection>
      {children}
    </Page>
  );
}

/** Detail values and actions; the page lead owns the explanation. */
function pageRows(
  page: SensorPage,
  actions: BoardActions,
  sessionId: string | null,
  now: number,
): (ReactElement | null)[] {
  const { board, busy } = actions;
  if (page === 'status') return statusRows(board, busy);
  if (page === 'callActivity') return callActivityRows(board);
  if (page === 'connectivity') return connectivityRows(board);
  if (page === 'location') return locationRows({ ...actions, sessionId, now });
  if (page === 'weather') return weatherRows({ ...actions, sessionId });
  return signalRows(board, page);
}

function statusRows(board: SensorBoardState, busy: boolean): (ReactElement | null)[] {
  return [
    <Row key="state" label={copy('collection.row.state')} value={collectionState(board, busy)} />,
    warning(board.collection.failure && failureText(board.collection.failure), 'failure'),
    <Row
      key="collectedAt"
      label={copy('collection.row.collectedAt')}
      value={moment(board.collection.collectedAt)}
    />,
  ];
}

function collectionState(board: SensorBoardState, busy: boolean): string {
  if (board.collection.paused) return t('sensors.state.paused');
  return copy(busy ? 'collection.state.collecting' : 'collection.state.idle');
}

function collectionSummary(board: SensorBoardState, busy: boolean): string {
  if (board.collection.failure) return failureText(board.collection.failure);
  return collectionState(board, busy);
}

/** The permission a page's readings wait on, when they wait on one. */
function pagePermission(board: SensorBoardState, page: SensorPage) {
  if (page === 'barometer') return board.permissions.motion;
  if (page === 'bluetooth') return board.permissions.bluetooth;
  return undefined;
}

function boardSummary(board: SensorBoardState, page: SensorPage): string {
  if (page === 'weather') {
    if (board.weather.failure) return failureText(board.weather.failure);
    return t(`sensors.weather.summary.${board.weather.state}`);
  }
  if (page === 'location') {
    if (board.location.failure) return failureText(board.location.failure);
    return plain(board.permissions.location);
  }
  const permission = pagePermission(board, page);
  if (permission && permission !== 'given') return plain(permission);
  return signalSummary(board, page);
}
