import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { required } from '../testing/support';
import { ControllerCustodyContext, type IdentityCustody } from './ControllerCustody';
import { useControllerState } from './useControllerState';

type Controller = { name: string };
type Connection = {
  controller: Controller;
  initialState: string;
  dispose: () => undefined | Promise<unknown>;
};
type Connect = (publish: (state: string) => void) => Connection | undefined;
let view: ReactTestRenderer | undefined;
let current: ReturnType<typeof useControllerState<string, Controller>> | undefined;
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const custody = (): IdentityCustody => ({ releasing: Promise.resolve(), reportFailure: jest.fn() });
function observer(connect: Connect, owner: IdentityCustody) {
  return (
    <ControllerCustodyContext.Provider value={owner}>
      <Observer connect={connect} />
    </ControllerCustodyContext.Provider>
  );
}
function Observer({ connect }: { connect: Connect }) {
  const value = useControllerState('waiting', connect);
  useLayoutEffect(() => {
    current = value;
  }, [value]);
  return null;
}
function connection(name = 'first') {
  return {
    controller: { name },
    initialState: 'connected',
    dispose: jest.fn<Promise<void>, []>(async () => {}),
  };
}
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  current = undefined;
});
test.each([false, true])('an existing waiter rejoins extended custody A+B (B rejects: %s)', async (fails) => {
  const a = deferred();
  const b = deferred();
  const owner = custody();
  owner.releasing = a.promise;
  const next = connection();
  const connect = jest.fn(() => next);
  await act(async () => {
    view = create(observer(connect, owner));
  });
  owner.releasing = Promise.all([a.promise, b.promise]);
  const failure = new Error('cleanup B failed');
  await act(async () => a.resolve());
  expect(connect).not.toHaveBeenCalled();
  expect(required(current).state).toBe('waiting');
  await act(async () => {
    if (fails) b.reject(failure);
    else b.resolve();
  });
  if (fails) {
    expect(connect).not.toHaveBeenCalled();
    expect(required(current).failed).toBe(true);
    expect(owner.reportFailure).toHaveBeenCalledWith(failure);
    await expect(owner.releasing).rejects.toBe(failure);
  } else {
    expect(connect).toHaveBeenCalledTimes(1);
    expect(required(current).controller).toBe(next.controller);
    expect(required(current).state).toBe('connected');
    expect(required(current).failed).toBe(false);
  }
});
test.each([false, true])(
  'canceling startup prevents acquisition and late failure publication (barrier rejects: %s)',
  async (fails) => {
    const barrier = deferred();
    const owner = custody();
    owner.releasing = barrier.promise;
    const next = connection();
    const connect = jest.fn(() => next);
    await act(async () => {
      view = create(observer(connect, owner));
    });
    await act(async () => required(current).cancelStartup());
    const failure = new Error('late cleanup failure');
    await act(async () => {
      if (fails) barrier.reject(failure);
      else barrier.resolve();
    });
    expect(connect).not.toHaveBeenCalled();
    expect(next.dispose).not.toHaveBeenCalled();
    expect(required(current).failed).toBe(false);
    expect(required(current).controller).toBeUndefined();
    if (fails) {
      await expect(owner.releasing).rejects.toBe(failure);
      expect(owner.reportFailure).toHaveBeenCalledWith(failure);
    }
  },
);
test('cancelStartup does not dispose an already connected controller', async () => {
  const owner = custody();
  const first = connection();
  await act(async () => {
    view = create(observer(() => first, owner));
  });
  await act(async () => required(current).cancelStartup());
  expect(required(current).controller).toBe(first.controller);
  expect(first.dispose).not.toHaveBeenCalled();
  await act(async () => required(view).unmount());
  view = undefined;
  expect(first.dispose).toHaveBeenCalledTimes(1);
});
test('a synchronous connection throw marks failure and keeps every successor blocked', async () => {
  const owner = custody();
  const failure = new Error('synchronous connection failure');
  await act(async () => {
    view = create(
      observer(() => {
        throw failure;
      }, owner),
    );
  });
  expect(required(current).failed).toBe(true);
  expect(required(current).controller).toBeUndefined();
  expect(owner.reportFailure).toHaveBeenCalledWith(failure);
  await expect(owner.releasing).rejects.toBe(failure);
  const connect = jest.fn(() => connection('replacement'));
  await act(async () => required(view).update(observer(connect, owner)));
  expect(connect).not.toHaveBeenCalled();
  expect(required(current).failed).toBe(true);
  await expect(owner.releasing).rejects.toBe(failure);
});
test('synchronous publication is preserved, and a replaced publisher cannot overwrite its successor', async () => {
  const owner = custody();
  const first = connection();
  let publish!: (state: string) => void;
  const connect: Connect = (changed) => {
    publish = changed;
    changed('published during connect');
    return first;
  };
  await act(async () => {
    view = create(observer(connect, owner));
  });
  expect(required(current).state).toBe('published during connect');
  expect(required(current).controller).toBe(first.controller);
  await act(async () => publish('later state'));
  expect(required(current).state).toBe('later state');
  const second = connection('replacement');
  await act(async () => required(view).update(observer(() => second, owner)));
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(required(current).controller).toBe(second.controller);
  await act(async () => publish('stale state'));
  expect(required(current).state).toBe('connected');
  expect(required(current).controller).toBe(second.controller);
});
test.each(['synchronous', 'asynchronous'])(
  '%s disposal failure is retained and prevents replacement acquisition',
  async (mode) => {
    const owner = custody();
    const failure = new Error('disposal failure');
    const first = connection();
    first.dispose.mockImplementation(() => {
      if (mode === 'synchronous') throw failure;
      return Promise.reject(failure);
    });
    await act(async () => {
      view = create(observer(() => first, owner));
    });
    const next = jest.fn(() => connection('replacement'));
    await act(async () => required(view).update(observer(next, owner)));
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(required(current).failed).toBe(true);
    expect(owner.reportFailure).toHaveBeenCalledWith(failure);
    await expect(owner.releasing).rejects.toBe(failure);
    await act(async () => required(view).unmount());
    view = undefined;
    expect(first.dispose).toHaveBeenCalledTimes(1);
  },
);
