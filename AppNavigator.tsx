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
import { type ComponentProps, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { AirCheckScreen } from './AirCheckScreen';
import { ContinuityScreen } from './ContinuityScreen';
import { DriverLicenseFlow } from './DriverLicenseFlow';
import { GlossaryScreen, OverTimeScreen, ThreeProofsScreen } from './FusionExplanations';
import { type FusionDestination, FusionScreen } from './FusionScreen';
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
import {
  ControllerCustodyContext,
  createControllerCustody,
  type IdentityCustody,
} from './ui/ControllerCustody';
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
/** Four tabs in a native UITabBar, each its own native stack. */
type TabRoutes = {
  FusionTab: undefined;
  IdentityTab: undefined;
  SensorsTab: undefined;
  SettingsTab: undefined;
};
type IdentityRoutes = {
  IdentityHome: undefined;
  PassportResult: { focus: 'passport' | 'face' };
  LicenseResult: undefined;
};
type SensorRoutes = { SensorBoard: undefined; SensorDetail: { page: SensorPage } };
type SettingsRoutes = { SettingsHome: undefined; DeveloperChecks: undefined };
type FusionRoutes = { FusionHome: undefined } & { [Page in FusionDestination]: undefined };
const FusionStack = createNativeStackNavigator<FusionRoutes>();
const Root = createNativeStackNavigator<RootRoutes>();
const Tabs = createNativeBottomTabNavigator<TabRoutes>();
const IdentityStack = createNativeStackNavigator<IdentityRoutes>();
const SensorStack = createNativeStackNavigator<SensorRoutes>();
const SettingsStack = createNativeStackNavigator<SettingsRoutes>();
type IdentityNavigation = NativeStackNavigationProp<IdentityRoutes>;
/** Native stacks own transitions. Page owns the visible header and every screen's layout. */
const pushed: NativeStackNavigationOptions = { headerShown: false };
/** Only visible sensor surfaces own collection; identity modals and developer checks do not. */
function sensorTabFocused(state: NavigationState | undefined): boolean {
  const root = state?.routes[state.index];
  if (root?.name !== 'Tabs') return false;
  const tabs = root.state;
  if (!tabs || typeof tabs.index !== 'number') return false;
  const focused = tabs.routes[tabs.index];
  if (focused?.name === 'FusionTab' || focused?.name === 'SensorsTab') return true;
  if (focused?.name !== 'SettingsTab') return false;
  const settings = focused.state;
  return !settings || settings.routes[settings.index ?? 0]?.name === 'SettingsHome';
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

type AppNavigatorProps = {
  configuration: Configuration;
  developerChecks: boolean;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
};

/** A configuration owns one mounted workspace. Replacing it removes the old screens and their
 * state together; the shared custody barrier waits for their native controllers to close. */
export function AppNavigator(props: AppNavigatorProps) {
  const [holder, setHolder] = useState({ configuration: props.configuration, revision: 0 });
  const [custody] = useState(createControllerCustody);
  if (holder.configuration !== props.configuration) {
    setHolder({ configuration: props.configuration, revision: holder.revision + 1 });
  }
  return (
    <ControllerCustodyContext.Provider value={custody}>
      <HolderNavigator key={holder.revision} {...props} custody={custody} />
    </ControllerCustodyContext.Provider>
  );
}

function HolderNavigator({
  configuration,
  developerChecks,
  configurationIssue,
  custody,
}: AppNavigatorProps & { custody: IdentityCustody }) {
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
  const workspace = useIdentityWorkspace(configuration, home, openFlow, custody);
  const registerIdentityNavigation = useCallback((value: IdentityNavigation | undefined) => {
    identityNavigation.current = value;
  }, []);
  function renderIdentityTab() {
    return (
      <IdentityStack.Navigator screenOptions={pushed}>
        <IdentityStack.Screen name="IdentityHome" options={{ title: t('hub.title') }}>
          {({ navigation: identity }: { navigation: IdentityNavigation }) => (
            <IdentityHomeRoute
              navigation={identity}
              register={registerIdentityNavigation}
              configuration={configuration}
              configurationIssue={configurationIssue}
              workspace={workspace}
            />
          )}
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
  function renderFusionTab() {
    return (
      <FusionStack.Navigator screenOptions={pushed}>
        <FusionStack.Screen name="FusionHome" options={{ title: copy('fusion.navigationTitle') }}>
          {({ navigation: fusion }: { navigation: NativeStackNavigationProp<FusionRoutes> }) => (
            <FusionScreen onOpen={(page) => fusion.navigate(page)} />
          )}
        </FusionStack.Screen>
        <FusionStack.Screen
          name="AirCheck"
          component={AirCheckScreen}
          options={{ title: copy('airCheck.navigationTitle') }}
        />
        <FusionStack.Screen name="Continuity" options={{ title: copy('continuity.header') }}>
          {({ navigation: fusion }: { navigation: NativeStackNavigationProp<FusionRoutes> }) => (
            <ContinuityScreen onOverTime={() => fusion.navigate('OverTime')} />
          )}
        </FusionStack.Screen>
        <FusionStack.Screen
          name="OverTime"
          component={OverTimeScreen}
          options={{ title: copy('overTime.title') }}
        />
        <FusionStack.Screen
          name="ThreeProofs"
          component={ThreeProofsScreen}
          options={{ title: copy('threeProofs.title') }}
        />
        <FusionStack.Screen
          name="Glossary"
          component={GlossaryScreen}
          options={{ title: copy('glossary.title') }}
        />
      </FusionStack.Navigator>
    );
  }
  function renderTabs() {
    return (
      <Tabs.Navigator screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="FusionTab"
          options={{ title: copy('fusion.tab'), tabBarIcon: { type: 'sfSymbol', name: symbol.fusionTab } }}
        >
          {renderFusionTab}
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
          name="IdentityTab"
          options={{ title: t('hub.title'), tabBarIcon: { type: 'sfSymbol', name: symbol.identityTab } }}
        >
          {renderIdentityTab}
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
        onReady={() => setSensorsOpen(sensorTabFocused(navigation.getRootState()))}
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
                onClaim={workspace.passport.claim}
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
                onClaim={workspace.license.claim}
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
                onClaim={workspace.ssn.claim}
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
                onClaim={workspace.phone.claim}
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

/** Register only after this route commits; an abandoned render must not change navigation ownership. */
function IdentityHomeRoute({
  navigation,
  register,
  ...props
}: Omit<ComponentProps<typeof IdentityHome>, 'onLicenseResult' | 'onPassportResult'> & {
  navigation: IdentityNavigation;
  register: (navigation: IdentityNavigation | undefined) => void;
}) {
  useLayoutEffect(() => {
    register(navigation);
    return () => register(undefined);
  }, [navigation, register]);
  return (
    <IdentityHome
      {...props}
      onLicenseResult={() => navigation.navigate('LicenseResult')}
      onPassportResult={(focus) => navigation.navigate('PassportResult', { focus })}
    />
  );
}
