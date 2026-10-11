import type { Configuration } from '@kenshiki/identity-capture';
import { AppNavigator } from './AppNavigator';
import { AppContainer } from './ui/AppContainer';

const emptyConfiguration: Configuration = {};

/** The host supplies configuration; navigation composes the screens and their session owners.
 * `developerChecks` is set only by the simulator Debug AppDelegate. `configurationIssue` names
 * a native configuration step that failed before React mounted. */
export default function App({
  configuration = emptyConfiguration,
  developerChecks = false,
  configurationIssue,
}: Readonly<{
  configuration?: Configuration | undefined;
  developerChecks?: boolean | undefined;
  configurationIssue?: 'holderScopeUnreadable' | 'liveServicesUnavailable' | undefined;
}>) {
  return (
    <AppContainer configuration={configuration}>
      <AppNavigator
        configuration={configuration}
        developerChecks={developerChecks}
        configurationIssue={configurationIssue}
      />
    </AppContainer>
  );
}
