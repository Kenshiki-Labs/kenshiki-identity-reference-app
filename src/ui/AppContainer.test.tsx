import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import * as ReactNative from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import '../testing/support';
import { AppContainer } from './AppContainer';
import { appearanceColor } from './tokens.generated';

test('navigation follows light, dark and unspecified appearance without remounting content', async () => {
  const scheme = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(
        <AppContainer>
          <ReactNative.Text>Content</ReactNative.Text>
        </AppContainer>,
      );
    });
    const content = view.root.findByType(ReactNative.Text);
    for (const appearance of ['light', 'dark', null] as const) {
      scheme.mockReturnValue(appearance);
      await act(async () => {
        view.update(
          <AppContainer>
            <ReactNative.Text>Content</ReactNative.Text>
          </AppContainer>,
        );
      });
      const base = appearance === 'dark' ? DarkTheme : DefaultTheme;
      expect(view.root.findByType(NavigationContainer).props.theme).toEqual({
        ...base,
        colors: { ...base.colors, primary: appearanceColor.tint[appearance === 'dark' ? 'dark' : 'light'] },
      });
      expect(view.root.findByType(ReactNative.Text)).toBe(content);
    }
  } finally {
    if (view) await act(async () => view.unmount());
    scheme.mockRestore();
  }
});
