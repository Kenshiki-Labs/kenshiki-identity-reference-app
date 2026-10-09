import type { Configuration } from '@kenshiki/identity-capture';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './AppNavigator';

const emptyConfiguration: Configuration = {};

/** The host supplies configuration; navigation composes the screens and their session owners.
 * `developerChecks` is set only by the simulator Debug AppDelegate. */
export default function App({
  configuration = emptyConfiguration,
  developerChecks = false,
  configurationIssue,
}: {
  configuration?: Configuration | undefined;
  developerChecks?: boolean | undefined;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
}) {
  return (
    <SafeAreaProvider>
      <AppNavigator
        configuration={configuration}
        developerChecks={developerChecks}
        configurationIssue={configurationIssue}
      />
    </SafeAreaProvider>
  );
}
