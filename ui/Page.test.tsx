import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ScrollView, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, required } from '../__tests__/support';
import { NativeSheet } from './NativeSheet';
import { Page } from './Page';
import { Wordmark } from './Wordmark';

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
