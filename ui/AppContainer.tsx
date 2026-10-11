import type { Configuration } from '@kenshiki/identity-capture';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { type ReactNode, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ControllerCustodyContext, createControllerCustody } from './ControllerCustody';
import { appearanceColor } from './tokens.generated';

/** One navigation and safe-area root. A changed configuration discards every old route;
 * custody lives above that reset so replacement sessions still wait for old owners to close. */
export function AppContainer({
  children,
  configuration,
}: Readonly<{ children: ReactNode; configuration?: Configuration }>) {
  const [owner, setOwner] = useState({ configuration, revision: 0 });
  const [custody] = useState(createControllerCustody);
  if (owner.configuration !== configuration) {
    setOwner({ configuration, revision: owner.revision + 1 });
  }
  const appearance = useColorScheme() === 'dark' ? 'dark' : 'light';
  const base = appearance === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: appearanceColor.tint[appearance] } };
  return (
    <SafeAreaProvider>
      <ControllerCustodyContext.Provider value={custody}>
        <NavigationContainer key={owner.revision} theme={theme}>
          {children}
        </NavigationContainer>
      </ControllerCustodyContext.Provider>
    </SafeAreaProvider>
  );
}
