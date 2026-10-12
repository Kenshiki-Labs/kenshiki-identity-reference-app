import { IdentitySymbol } from '@kenshiki/identity-capture';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Modal, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, property, required } from '../testing/support';
import { NativeSheet } from './NativeSheet';
import { Page, PageHeaderContext } from './Page';
import { PageLead } from './PageLead';
import { Wordmark } from './Wordmark';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'MockSymbol' }));

test('native navigation owns page chrome while an enclosed sheet retains its title and Done action', async () => {
  const dismiss = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <PageHeaderContext.Provider value="native">
        <Page title="Detail" testID="native-detail">
          <NativeSheet title="Explanation" onDismiss={dismiss}>
            <Text>Sheet content</Text>
          </NativeSheet>
        </Page>
      </PageHeaderContext.Provider>,
    );
  });
  const pages = view.root.findAllByType(Page);
  const detail = required(pages.find((node) => node.props.testID === 'native-detail'));
  const sheet = required(pages.find((node) => node.props.mode === 'sheet'));
  // Only the sheet has branded chrome and a drawn title; it must not inherit the tab header.
  expect(detail.findAllByType(Wordmark)).toHaveLength(1);
  expect(sheet.findByProps({ testID: 'page-title' }).props.children).toBe('Explanation');
  expect(detail.findAllByProps({ testID: 'page-back' })).toHaveLength(0);
  const scrolls = detail.findAllByType(ScrollView);
  expect(required(scrolls[0]).props.contentInsetAdjustmentBehavior).toBe('never');
  await act(async () => {
    await invoke(sheet.findByProps({ testID: 'modal-cancel' }), 'onPress');
  });
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

test.each(['scroll', 'camera', 'sheet'] as const)(
  '%s uses one brand and hides all underlying controls when covered',
  async (mode) => {
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <Page title="Capture" mode={mode} covered onClose={jest.fn()} testID="covered-page">
          <Text>Content</Text>
        </Page>,
      );
    });
    expect(view.root.findAllByType(Wordmark)).toHaveLength(1);
    const surface = required(
      view.root
        .findAllByProps({ testID: 'covered-page' })
        .find((node) => node.props.accessibilityElementsHidden === true),
    );
    expect(surface.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(surface.findAllByProps({ testID: 'modal-cancel' }).length).toBeGreaterThan(0);
    const scroll = view.root.findAllByType(ScrollView);
    expect(scroll).toHaveLength(mode === 'camera' ? 0 : 1);
    if (mode !== 'camera') expect(required(scroll[0]).props.automaticallyAdjustKeyboardInsets).toBe(true);
    await act(async () => view.unmount());
  },
);

test('Back pops a detail screen; a recovery sheet has no implicit route dismissal', async () => {
  type Routes = { Home: undefined; Detail: undefined };
  const Stack = createNativeStackNavigator<Routes>();
  const navigation = createNavigationContainerRef<Routes>();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <NavigationContainer ref={navigation}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home">{() => <Page title="Home" />}</Stack.Screen>
          <Stack.Screen name="Detail">
            {() => (
              <Page title="Detail">
                <NativeSheet title="Recovery">
                  <Text>Recovery action required</Text>
                </NativeSheet>
              </Page>
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>,
    );
  });
  expect(view.root.findAllByProps({ testID: 'page-back' })).toHaveLength(0);
  await act(async () => navigation.navigate('Detail'));
  const sheet = required(view.root.findAllByType(Page).find((node) => node.props.mode === 'sheet'));
  expect(sheet.findAllByProps({ testID: 'page-back' })).toHaveLength(0);
  expect(sheet.findAllByProps({ testID: 'modal-cancel' })).toHaveLength(0);
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'page-back' }), 'onPress');
  });
  expect(navigation.getCurrentRoute()?.name).toBe('Home');
  await act(async () => view.unmount());
});

test.each(['scroll', 'camera', 'sheet'] as const)(
  'custom %s navigation preserves its handler and uses the shared affordance',
  async (mode) => {
    const close = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<Page mode={mode} onClose={close} />);
    });
    const control = view.root.findByProps({ testID: 'modal-cancel' });
    expect(control.props.label).toBe(mode === 'camera' ? 'Cancel' : mode === 'sheet' ? 'Done' : 'Back');
    const chevrons = view.root.findAllByType(IdentitySymbol);
    expect(chevrons).toHaveLength(mode === 'scroll' ? 1 : 0);
    if (mode === 'scroll') expect(required(chevrons[0]).props.name).toBe('chevron.left');
    await act(async () => {
      await invoke(control, 'onPress');
    });
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.unmount();
    });
  },
);

test('native Back waits for successful handoff, blocks duplicate taps, and retains failed ownership', async () => {
  type Routes = { Home: undefined; Detail: undefined };
  const Stack = createNativeStackNavigator<Routes>();
  const navigation = createNavigationContainerRef<Routes>();
  let settleClose!: (success: boolean) => void;
  const close = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        settleClose = resolve;
      }),
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <NavigationContainer ref={navigation}>
        <PageHeaderContext.Provider value="native">
          <Stack.Navigator>
            <Stack.Screen name="Home">{() => <Page title="Home" />}</Stack.Screen>
            <Stack.Screen name="Detail">{() => <Page title="Detail" onClose={close} />}</Stack.Screen>
          </Stack.Navigator>
        </PageHeaderContext.Provider>
      </NavigationContainer>,
    );
  });
  // Navigation becomes ready only after mounting.
  await act(async () => navigation.navigate('Detail'));
  await act(async () => navigation.goBack());
  expect(navigation.getCurrentRoute()?.name).toBe('Detail');
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => navigation.goBack());
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => settleClose(false));
  expect(navigation.getCurrentRoute()?.name).toBe('Detail');
  await act(async () => navigation.goBack());
  expect(close).toHaveBeenCalledTimes(2);
  await act(async () => settleClose(true));
  expect(navigation.getCurrentRoute()?.name).toBe('Home');
  await act(async () => view.unmount());
});

test.each(['native', 'custom'] as const)('%s header owns exactly its safe-area edges', async (header) => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <Page header={header}>
        <Text>Content</Text>
      </Page>,
    );
  });
  expect(view.root.findByType(SafeAreaView).props.edges).toEqual(
    header === 'native' ? ['left', 'right', 'bottom'] : ['top', 'left', 'right'],
  );
  expect(view.root.findByType(ScrollView).props.contentInsetAdjustmentBehavior).toBe(
    header === 'native' ? 'never' : 'automatic',
  );
  await act(async () => view.unmount());
});

test('camera content owns the bottom inset separately from custom chrome', async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <Page mode="camera">
        <Text>Camera</Text>
      </Page>,
    );
  });
  expect(view.root.findAllByType(SafeAreaView).map((node) => property(node, 'edges'))).toEqual([
    ['top', 'left', 'right'],
    ['bottom'],
  ]);
  await act(async () => view.unmount());
});

test.each([false, true])(
  'sheet platform dismissal follows its owner (dismissible: %s)',
  async (dismissible) => {
    const dismiss = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <NativeSheet title="Sheet" onDismiss={dismissible ? dismiss : undefined}>
          <Text>Body</Text>
        </NativeSheet>,
      );
    });
    const modal = view.root.findByType(Modal);
    expect(modal.props.presentationStyle).toBe('pageSheet');
    expect(modal.props.allowSwipeDismissal).toBe(dismissible);
    expect(view.root.findByType(Page).props.header).toBe('custom');
    expect(view.root.findByType(SafeAreaView).props.accessibilityViewIsModal).toBe(true);
    if (dismissible) {
      await act(async () => {
        invoke(modal, 'onRequestClose');
      });
      expect(dismiss).toHaveBeenCalledTimes(1);
    } else {
      expect(modal.props.onRequestClose).toBeUndefined();
      expect(view.root.findAllByProps({ testID: 'modal-cancel' })).toHaveLength(0);
      expect(dismiss).not.toHaveBeenCalled();
    }
    await act(async () => view.unmount());
  },
);

async function guardedStack(close: () => unknown) {
  type Routes = { Home: undefined; Middle: undefined; Detail: undefined; Replacement: undefined };
  const Stack = createNativeStackNavigator<Routes>();
  const navigation = createNavigationContainerRef<Routes>();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <NavigationContainer ref={navigation}>
        <PageHeaderContext.Provider value="native">
          <Stack.Navigator>
            <Stack.Screen name="Home">{() => <Page title="Home" />}</Stack.Screen>
            <Stack.Screen name="Middle">{() => <Page title="Middle" />}</Stack.Screen>
            <Stack.Screen name="Detail">{() => <Page title="Detail" onClose={close} />}</Stack.Screen>
            <Stack.Screen name="Replacement">{() => <Page title="Replacement" />}</Stack.Screen>
          </Stack.Navigator>
        </PageHeaderContext.Provider>
      </NavigationContainer>,
    );
  });
  await act(async () => navigation.navigate('Middle'));
  await act(async () => navigation.navigate('Detail'));
  return { view, navigation };
}

test.each(['throw', 'reject'] as const)(
  'a %s from close retains the route and permits a new Back attempt',
  async (mode) => {
    const close = jest
      .fn<unknown, []>()
      .mockImplementationOnce(() => {
        if (mode === 'throw') throw new Error('handoff failed');
        return Promise.reject(new Error('handoff failed'));
      })
      .mockReturnValueOnce(Promise.resolve(true));
    const { view, navigation } = await guardedStack(close);
    await act(async () => navigation.goBack());
    expect(navigation.getCurrentRoute()?.name).toBe('Detail');
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => navigation.goBack());
    expect(navigation.getCurrentRoute()?.name).toBe('Middle');
    expect(close).toHaveBeenCalledTimes(2);
    await act(async () => view.unmount());
  },
);

test('successful handoff replays a targeted reset rather than replacing it with a one-level Back', async () => {
  let finish!: (success: boolean) => void;
  const close = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const { view, navigation } = await guardedStack(close);
  const action = {
    type: 'RESET',
    target: required(navigation.getRootState()).key,
    payload: { index: 0, routes: [{ name: 'Replacement' }] },
  };
  await act(async () => navigation.dispatch(action));
  expect(navigation.getCurrentRoute()?.name).toBe('Detail');
  await act(async () => finish(true));
  expect(required(navigation.getRootState()).routes.map((route) => route.name)).toEqual(['Replacement']);
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

test('a handoff that settles after its navigation root unmounts cannot navigate the replacement root', async () => {
  let finish!: (success: boolean) => void;
  const { view, navigation } = await guardedStack(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => navigation.goBack());
  await act(async () => view.unmount());
  const replacement = await guardedStack(() => true);
  const before = replacement.navigation.getRootState();
  await act(async () => finish(true));
  expect(navigation.isReady()).toBe(false);
  expect(replacement.navigation.getRootState()).toBe(before);
  await act(async () => replacement.view.unmount());
});

test.each(['native', 'custom'] as const)(
  '%s Page places its lead once inside the scroll view without another content title',
  async (header) => {
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <Page
          header={header}
          title="Navigation title"
          lead={<PageLead title="Content headline" description="Explanation" />}
        >
          <Text>Results</Text>
        </Page>,
      );
    });
    expect(view.root.findAllByType(PageLead)).toHaveLength(1);
    expect(view.root.findByType(ScrollView).findAllByType(PageLead)).toHaveLength(1);
    expect(view.root.findAllByProps({ testID: 'page-title' })).toHaveLength(0);
    expect(
      view.root
        .findAllByType(Text)
        .map((node) => property(node, 'children'))
        .filter(
          (value) =>
            typeof value === 'string' && ['Content headline', 'Explanation', 'Results'].includes(value),
        ),
    ).toEqual(['Content headline', 'Explanation', 'Results']);
    await act(async () => view.unmount());
  },
);
