import type { Configuration } from '@kenshiki/identity-capture';
import { useLayoutEffect } from 'react';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { required } from '../testing/support';
import { t } from '../locales/i18n';
import { SensorSession, useSensorSession } from './SensorScreen';
import { ControllerCustodyContext, type IdentityCustody } from '../ui/ControllerCustody';

// These are adapter rejection tests: the controller is deliberately allowed to reject after
// dispose so the React owner must defend its replacement. Real controller/native lifecycle
// behavior is separately covered by SensorSessionLifecycle and SensorBoardController tests.
function controller() {
  return {
    open: jest.fn<Promise<void>, []>(async () => {}),
    setActive: jest.fn<Promise<void>, [boolean]>(async () => {}),
    perform: jest.fn<Promise<void>, [unknown]>(async () => {}),
    dispose: jest.fn<Promise<void>, []>(async () => {}),
  };
}
const mockBuild = jest.fn<ReturnType<typeof controller>, []>();
jest.mock('./SensorBoardController', () => ({ SensorBoardController: jest.fn(() => mockBuild()) }));
jest.mock('@kenshiki/identity-capture', () => ({}));
const configuration: Configuration = {};
const operations = ['open', 'setActive', 'perform'] as const;
const messages = {
  open: t('sensors.failure.open'),
  setActive: t('sensors.failure.activity'),
  perform: t('sensors.failure.request'),
};
let view: ReactTestRenderer | undefined;
let context: ReturnType<typeof useSensorSession> | undefined;
const removes: jest.Mock[] = [];
const originalState = AppState.currentState;
function Observer() {
  const value = useSensorSession();
  useLayoutEffect(() => {
    context = value;
    return () => {
      context = undefined;
    };
  }, [value]);
  return null;
}
function screen(owner: IdentityCustody, config = configuration, open = true) {
  return (
    <ControllerCustodyContext.Provider value={owner}>
      <SensorSession configuration={config} open={open}>
        <Observer />
      </SensorSession>
    </ControllerCustodyContext.Provider>
  );
}
function deferredFailure() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, no) => {
    reject = no;
  });
  return { promise, reject };
}
async function begin(operation: (typeof operations)[number]) {
  const pending = deferredFailure();
  const first = controller();
  const owner: IdentityCustody = { releasing: Promise.resolve(), reportFailure: jest.fn() };
  first[operation].mockImplementationOnce(() => pending.promise);
  mockBuild.mockReturnValueOnce(first);
  await act(async () => {
    view = create(screen(owner));
  });
  if (operation === 'perform') await act(async () => required(context).perform({ action: 'status' }));
  expect(first[operation]).toHaveBeenCalledTimes(1);
  expect(required(context).failure).toBeNull();
  return { first, owner, pending };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockBuild.mockReset();
  removes.length = 0;
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
    const remove = jest.fn();
    removes.push(remove);
    return { remove };
  });
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
  AppState.currentState = originalState;
  jest.restoreAllMocks();
});
test.each(operations)(
  'a current %s rejection publishes the localized failure and remains clearable',
  async (operation) => {
    const { first, pending } = await begin(operation);
    await act(async () => pending.reject(new Error('private native error details')));
    expect(required(context).failure).toBe(messages[operation]);
    await act(async () => required(context).setFailure(null));
    expect(required(context).failure).toBeNull();
    await act(async () => required(view).unmount());
    view = undefined;
    expect(first.dispose).toHaveBeenCalledTimes(1);
  },
);
test.each(operations)(
  "a replaced owner's %s rejection cannot erase the current failure",
  async (operation) => {
    const { first, owner, pending } = await begin(operation);
    const next = controller();
    mockBuild.mockReturnValueOnce(next);
    await act(async () => required(view).update(screen(owner, { ...configuration })));
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(next.open).toHaveBeenCalledTimes(1);
    await act(async () => required(context).setFailure('current failure'));
    await act(async () => pending.reject(new Error('stale native error')));
    expect(required(context).failure).toBe('current failure');
    expect(next.dispose).not.toHaveBeenCalled();
  },
);
test.each(operations)(
  "an unmounted owner's %s rejection cannot publish or dispose twice",
  async (operation) => {
    const { first, pending } = await begin(operation);
    await act(async () => required(view).unmount());
    view = undefined;
    expect(context).toBeUndefined();
    await act(async () => pending.reject(new Error('late native error')));
    expect(context).toBeUndefined();
    expect(first.dispose).toHaveBeenCalledTimes(1);
  },
);
