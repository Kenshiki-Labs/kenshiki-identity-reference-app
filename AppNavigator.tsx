import type { Configuration } from '@kenshiki/identity-capture';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type NavigationState,
  StackActions,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { DriverLicenseFlow } from './DriverLicenseFlow';
import { IdentityCaptureFlow } from './IdentityCaptureFlow';
import { IdentityHome } from './IdentityHome';
import { IdentityRecovery } from './IdentityRecovery';
import { LicenseResult, PassportResult } from './IdentityResults';
import { IdentitySettings } from './IdentitySettings';
import { IntegrationChecks } from './IntegrationChecks';
import { t } from './locales/i18n';
import { PhoneFlow } from './PhoneFlow';
import { copy, type SensorPage, title } from './SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession } from './SensorScreen';
import { SSNFlow } from './SSNFlow';
import { appearanceColor, symbol } from './ui/tokens.generated';
import { type IdentityFlow, useIdentityWorkspace } from './useIdentityWorkspace';

/** The root: the tabs, and the checks presented over them as full-screen modals. A journey that
 * must run before the tabs, such as enrollment, becomes this stack's first route and replaces
 * itself with Tabs when it finishes. */
type RootRoutes = {
  Tabs: undefined;
  PassportCapture: undefined;
  LicenseCapture: undefined;
  SSNCheck: undefined;
  PhoneCheck: undefined;
};
/** Three tabs in a native UITabBar, each its own native stack. */
type TabRoutes = { IdentityTab: undefined; SensorsTab: undefined; SettingsTab: undefined };
type IdentityRoutes = {
  IdentityHome: undefined;
  PassportResult: { focus: 'passport' | 'face' };
  LicenseResult: undefined;
};
type SensorRoutes = { SensorBoard: undefined; SensorDetail: { page: SensorPage } };
type SettingsRoutes = { SettingsHome: undefined; DeveloperChecks: undefined };
const Root = createNativeStackNavigator<RootRoutes>();
const Tabs = createNativeBottomTabNavigator<TabRoutes>();
const IdentityStack = createNativeStackNavigator<IdentityRoutes>();
const SensorStack = createNativeStackNavigator<SensorRoutes>();
const SettingsStack = createNativeStackNavigator<SettingsRoutes>();
type IdentityNavigation = NativeStackNavigationProp<IdentityRoutes>;
/** Native stacks own transitions. Page owns the visible header and every screen's layout. */
const pushed: NativeStackNavigationOptions = { headerShown: false };

/** The sensor session runs while the Sensors or the Settings tab is in front. */
function sensorTabFocused(state: NavigationState | undefined): boolean {
  const tabs = state?.routes.find((route) => route.name === 'Tabs')?.state;
  if (!tabs || typeof tabs.index !== 'number') return false;
  const focused = tabs.routes[tabs.index]?.name;
  return focused === 'SensorsTab' || focused === 'SettingsTab';
}

/** React Navigation's theme in the brand's tint: the selected tab, the back button and bar buttons. */
function navigationTheme(appearance: 'light' | 'dark') {
  const base = appearance === 'dark' ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, primary: appearanceColor.tint[appearance] } };
}

const modal: NativeStackNavigationOptions = { presentation: 'fullScreenModal', gestureEnabled: false };
const flowRoutes = {
  passport: 'PassportCapture',
  license: 'LicenseCapture',
  ssn: 'SSNCheck',
  phone: 'PhoneCheck',
} as const;

export function AppNavigator({
  configuration,
  developerChecks,
  configurationIssue,
}: {
  configuration: Configuration;
  developerChecks: boolean;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
}) {
  const navigation = useNavigationContainerRef<RootRoutes>();
  const identityNavigation = useRef<IdentityNavigation | undefined>(undefined);
  const scheme = useColorScheme();
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const home = useCallback(() => {
    if (navigation.isReady() && navigation.canGoBack()) navigation.dispatch(StackActions.popToTop());
    const identity = identityNavigation.current;
    if (identity && identity.getState().routes.length > 1) identity.popToTop();
  }, [navigation]);
  const openFlow = useCallback((flow: IdentityFlow) => navigation.navigate(flowRoutes[flow]), [navigation]);
  const workspace = useIdentityWorkspace(configuration, home, openFlow);
  function renderIdentityTab() {
    return (
      <IdentityStack.Navigator screenOptions={pushed}>
        <IdentityStack.Screen name="IdentityHome" options={{ title: t('hub.title') }}>
          {({ navigation: identity }: { navigation: IdentityNavigation }) => {
            identityNavigation.current = identity;
            return (
              <IdentityHome
                configuration={configuration}
                configurationIssue={configurationIssue}
                workspace={workspace}
                onLicenseResult={() => identity.navigate('LicenseResult')}
                onPassportResult={(focus) => identity.navigate('PassportResult', { focus })}
              />
            );
          }}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="PassportResult" options={{ title: t('hub.resultsTitle') }}>
          {({ route }) => (
            <PassportResult configuration={configuration} workspace={workspace} focus={route.params.focus} />
          )}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="LicenseResult" options={{ title: t('hub.licenseTitle') }}>
          {() => <LicenseResult configuration={configuration} workspace={workspace} />}
        </IdentityStack.Screen>
      </IdentityStack.Navigator>
    );
  }
  function renderSensorsTab() {
    return (
      <SensorStack.Navigator screenOptions={pushed}>
        <SensorStack.Screen
          name="SensorBoard"
          options={{
            title: copy('tab.sensors.title'),
          }}
        >
          {({ navigation: sensors }: { navigation: NativeStackNavigationProp<SensorRoutes> }) => (
            <SensorBoardScreen onOpenPage={(page) => sensors.navigate('SensorDetail', { page })} />
          )}
        </SensorStack.Screen>
        <SensorStack.Screen
          name="SensorDetail"
          options={({ route }) => ({ title: title(route.params.page) })}
        >
          {({ route }) => <SensorDetailScreen page={route.params.page} />}
        </SensorStack.Screen>
      </SensorStack.Navigator>
    );
  }
  function renderSettingsTab() {
    return (
      <SettingsStack.Navigator screenOptions={pushed}>
        <SettingsStack.Screen name="SettingsHome" options={{ title: copy('tab.settings.title') }}>
          {({ navigation: settings }: { navigation: NativeStackNavigationProp<SettingsRoutes> }) => (
            <IdentitySettings
              workspace={workspace}
              developerChecks={developerChecks}
              onDeveloperChecks={() => settings.navigate('DeveloperChecks')}
            />
          )}
        </SettingsStack.Screen>
        {developerChecks && __DEV__ && (
          <SettingsStack.Screen name="DeveloperChecks" options={{ title: t('hub.action.developerChecks') }}>
            {() => <IntegrationChecks configuration={configuration} />}
          </SettingsStack.Screen>
        )}
      </SettingsStack.Navigator>
    );
  }
  function renderTabs() {
    return (
      <Tabs.Navigator screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="IdentityTab"
          options={{ title: t('hub.title'), tabBarIcon: { type: 'sfSymbol', name: symbol.identityTab } }}
        >
          {renderIdentityTab}
        </Tabs.Screen>
        <Tabs.Screen
          name="SensorsTab"
          options={{
            title: copy('tab.sensors.title'),
            tabBarIcon: { type: 'sfSymbol', name: symbol.sensorsTab },
          }}
        >
          {renderSensorsTab}
        </Tabs.Screen>
        <Tabs.Screen
          name="SettingsTab"
          options={{
            title: copy('tab.settings.title'),
            tabBarIcon: { type: 'sfSymbol', name: symbol.settingsTab },
          }}
        >
          {renderSettingsTab}
        </Tabs.Screen>
      </Tabs.Navigator>
    );
  }
  return (
    <SensorSession configuration={configuration} open={sensorsOpen}>
      <NavigationContainer
        ref={navigation}
        theme={navigationTheme(scheme === 'dark' ? 'dark' : 'light')}
        onStateChange={(state) => setSensorsOpen(sensorTabFocused(state))}
      >
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Tabs">{renderTabs}</Root.Screen>
          <Root.Screen name="PassportCapture" options={modal}>
            {() => (
              <IdentityCaptureFlow
                configuration={configuration}
                {...workspace.passport.input}
                onComplete={workspace.passport.accept}
                onExit={workspace.passport.exit}
              />
            )}
          </Root.Screen>
          <Root.Screen name="LicenseCapture" options={modal}>
            {() => (
              <DriverLicenseFlow
                configuration={configuration}
                {...workspace.license.input}
                onComplete={workspace.license.accept}
                onExit={workspace.license.exit}
              />
            )}
          </Root.Screen>
          <Root.Screen name="SSNCheck" options={modal}>
            {() => (
              <SSNFlow
                configuration={configuration}
                saved={workspace.ssn.input}
                onComplete={workspace.ssn.accept}
                onExit={workspace.ssn.exit}
              />
            )}
          </Root.Screen>
          <Root.Screen name="PhoneCheck" options={modal}>
            {() => (
              <PhoneFlow
                configuration={configuration}
                saved={workspace.phone.input}
                onComplete={workspace.phone.accept}
                onExit={workspace.phone.exit}
              />
            )}
          </Root.Screen>
        </Root.Navigator>
      </NavigationContainer>
      <IdentityRecovery configuration={configuration} workspace={workspace} />
    </SensorSession>
  );
}
