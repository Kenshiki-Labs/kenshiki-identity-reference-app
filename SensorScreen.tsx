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
import { t } from './locales/i18n';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';
import { SensorDocuments } from './SensorBoardDocuments';
import { type BoardActions, locationRows, useSecondClock, weatherRows } from './SensorBoardLocation';
import { note, Row, Section, SensorIconContext, signalRows, warning } from './SensorBoardRows';
import { SensorSettings } from './SensorBoardSettings';
import {
  copy,
  failureText,
  moment,
  pages,
  permissioned,
  prefix,
  type SensorPage,
  title,
} from './SensorPresentation';
import { ListGroupTitle, ListRow, ListSection, TextRow } from './ui/List';
import { Page } from './ui/Page';
import { useControllerState } from './ui/useControllerState';

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

/** The board: every sensor section, grouped by whether iOS asks permission first, as SensorHost's
 * Sensors tab lists them. Each section's last row opens its page. */
export function SensorBoardScreen({ onOpenPage }: Readonly<{ onOpenPage: (page: SensorPage) => void }>) {
  const { state, perform } = useContext(SensorSessionContext);
  const board = state.board;
  const now = useSecondClock();
  return (
    <SensorScroll title={copy('tab.sensors.title')} enabledIcons testID="sensor-screen">
      {board ? (
        <>
          <ListSection>
            {board.reading?.deviceSurface.simulator ? note(copy('sensorGroup.notice.simulator')) : null}
            {board.permissions.motion !== 'given' ? warning(copy('sensorGroup.notice.motion')) : null}
          </ListSection>
          {[false, true].map((requiresPermission) => [
            <ListGroupTitle
              key={`group-${String(requiresPermission)}`}
              title={copy(requiresPermission ? 'sensorGroup.permissioned' : 'sensorGroup.free')}
              note={copy(requiresPermission ? 'sensorGroup.permissioned.note' : 'sensorGroup.free.note')}
            />,
            ...pages
              .filter((page) => permissioned(page) === requiresPermission)
              .map((page) => (
                <Section key={page} section={prefix(page)}>
                  {pageRows(page, { board, busy: state.busy, perform }, state.sessionId, now)}
                  <ListRow
                    label={t('sensors.about', { title: title(page) })}
                    onPress={() => onOpenPage(page)}
                  />
                </Section>
              )),
          ])}
        </>
      ) : null}
    </SensorScroll>
  );
}

/** One sensor's page: its section without a header, since the page's title names it, then Apple's
 * documentation for it and, where the SDK computes the value, how. */
export function SensorDetailScreen({ page }: Readonly<{ page: SensorPage }>) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  const now = useSecondClock();
  return (
    <SensorScroll title={title(page)} enabledIcons={false} testID="sensor-detail">
      {board ? (
        <Section section={prefix(page)} heading={false}>
          {pageRows(page, { board, busy: state.busy, perform }, state.sessionId, now)}
        </Section>
      ) : null}
      <SensorDocuments page={page} onFailure={setFailure} />
    </SensorScroll>
  );
}

/** Export, units, permissions, reading time, erase, stores, where data is kept and limits, followed
 * by whatever settings of its own the app adds. */
export function SensorSettingsScreen({ children }: Readonly<{ children?: ReactNode }>) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll title={copy('tab.settings.title')} enabledIcons testID="sensor-settings">
      {board ? (
        <SensorSettings board={board} busy={state.busy} perform={perform} onFailure={setFailure} />
      ) : null}
      {children}
    </SensorScroll>
  );
}

/** What every sensor screen shows above its own sections: a failure, or that the board is still
 * opening. */
function SensorScroll({
  title,
  enabledIcons,
  testID,
  children,
}: Readonly<{
  title: string;
  enabledIcons: boolean;
  testID: string;
  children: ReactNode;
}>) {
  const { state, failure } = useContext(SensorSessionContext);
  const shown = failure || state.failure;
  return (
    <SensorIconContext.Provider value={{ sessionId: state.sessionId, enabled: enabledIcons }}>
      <Page title={title} testID={testID}>
        <ListSection>
          {shown ? <TextRow text={shown} tone="warning" alert /> : null}
          {state.board ? null : <TextRow text={t('sensors.opening')} />}
        </ListSection>
        {children}
      </Page>
    </SensorIconContext.Provider>
  );
}

/** A sensor's rows, as SensorHost lays out each section: what the sensor tells you, then its
 * values. One element per row. */
function pageRows(
  page: SensorPage,
  actions: BoardActions,
  sessionId: string | null,
  now: number,
): (ReactElement | null)[] {
  const { board, busy } = actions;
  const meaning = note(copy(`meaning.${page}`, ''), 'meaning');
  if (page === 'status') return [meaning, ...statusRows(board, busy)];
  if (page === 'location') return [meaning, ...locationRows({ ...actions, sessionId, now })];
  if (page === 'weather') return [meaning, ...weatherRows(actions)];
  return [meaning, ...signalRows(board, page)];
}

function statusRows(board: SensorBoardState, busy: boolean): (ReactElement | null)[] {
  return [
    <Row
      key="collectedAt"
      label={copy('collection.row.collectedAt')}
      value={moment(board.collection.collectedAt)}
    />,
    <Row
      key="state"
      label={copy('collection.row.state')}
      value={
        board.collection.paused
          ? t('sensors.state.paused')
          : copy(busy ? 'collection.state.collecting' : 'collection.state.idle')
      }
    />,
    warning(board.collection.failure && failureText(board.collection.failure), 'failure'),
  ];
}
