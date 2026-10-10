import type { Configuration } from '@kenshiki/identity-capture';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './AppNavigator';
import { FirstRunPermissions } from './FirstRunPermissions';

const emptyConfiguration: Configuration = {};

/** The host supplies configuration; navigation composes the screens and their session owners.
 * `developerChecks` is set only by the simulator Debug AppDelegate. `configurationIssue` names
 * a native configuration step that failed before React mounted. */
export default function App({
  configuration = emptyConfiguration,
  developerChecks = false,
  configurationIssue,
  firstRunPermissions = false,
}: {
  configuration?: Configuration | undefined;
  developerChecks?: boolean | undefined;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
  firstRunPermissions?: boolean | undefined;
}) {
  return (
    <SafeAreaProvider>
      <FirstRunPermissions configuration={configuration} enabled={firstRunPermissions}>
        <AppNavigator
          configuration={configuration}
          developerChecks={developerChecks}
          configurationIssue={configurationIssue}
        />
      </FirstRunPermissions>
    </SafeAreaProvider>
  );
}
