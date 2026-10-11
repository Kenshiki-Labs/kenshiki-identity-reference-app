import type { Configuration } from '@kenshiki/identity-capture';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import {
  type NavigationContainerRef,
  type NavigationState,
  StackActions,
  useNavigation,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AirCheckScreen } from './AirCheckScreen';
import { ContinuityScreen } from './ContinuityScreen';
import { DriverLicenseFlow } from './DriverLicenseFlow';
import { GlossaryScreen, OverTimeScreen, ThreeProofsScreen } from './FusionExplanations';
import { type FusionDestination, FusionScreen } from './FusionScreen';
import { IdentityCaptureFlow } from './IdentityCaptureFlow';
import { IdentityHome } from './IdentityHome';
import { IdentityPrerequisiteGate } from './IdentityPrerequisiteGate';
import { IdentityRecovery } from './IdentityRecovery';
import { LicenseResult, PassportResult } from './IdentityResults';
import { IdentitySettings } from './IdentitySettings';
import { IntegrationChecks } from './IntegrationChecks';
import { t } from './locales/i18n';
import { PhoneFlow } from './PhoneFlow';
import { copy, type SensorPage, title } from './SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession } from './SensorScreen';
import { SSNFlow } from './SSNFlow';
import { ControllerCustodyContext } from './ui/ControllerCustody';
import { PageHeaderContext } from './ui/Page';
import { symbol } from './ui/tokens.generated';
import { type IdentityFlow, useIdentityWorkspace } from './useIdentityWorkspace';

/** The main application's tabs and full-screen checks. AppContainer owns the navigation root. */
type RootRoutes = {
  Tabs: undefined;
  PassportCapture: undefined;
  LicenseCapture: undefined;
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
  PassportDetail: undefined;
  FaceDetail: undefined;
  LicenseDetail: undefined;
  PhoneDetail: undefined;
  SSNDetail: undefined;
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
/** Native stacks own titles and Back; Page owns the content below their nontransparent headers. */
const pushed: NativeStackNavigationOptions = { headerShown: true, headerTransparent: false };
/** Only visible sensor surfaces own collection; identity modals and developer checks do not. */
function sensorTabFocused(state: NavigationState | undefined): boolean {
  const root = state?.routes[state.index];
  if (root?.name !== 'Tabs') return false;
  const tabs = root.state;
  if (!tabs || typeof tabs.index !== 'number') return false;
  const focused = tabs.routes[tabs.index];
  if (focused?.name === 'SensorsTab') return true;
  if (focused?.name === 'FusionTab') {
    const fusion = focused.state;
    return fusion?.routes[fusion.index ?? 0]?.name !== 'Glossary';
  }
  if (focused?.name !== 'SettingsTab') return false;
  const settings = focused.state;
  return !settings || settings.routes[settings.index ?? 0]?.name === 'SettingsHome';
}

const modal: NativeStackNavigationOptions = { presentation: 'fullScreenModal', gestureEnabled: false };
/** A presented native surface measures its own insets, independent of the tab's header. */
function modalLayout({ children }: { children: ReactNode }) {
  return <SafeAreaProvider>{children}</SafeAreaProvider>;
}
const flowRoutes = {
  passport: 'PassportCapture',
  license: 'LicenseCapture',
} as const;

type AppNavigatorProps = {
  configuration: Configuration;
  developerChecks: boolean;
  configurationIssue?: 'holderScopeUnreadable' | 'liveServicesUnavailable' | undefined;
};

/** AppContainer owns configuration resets and retains custody while this workspace remounts. */
export function AppNavigator({
  configuration,
  developerChecks,
  configurationIssue,
}: Readonly<AppNavigatorProps>) {
  const custody = useContext(ControllerCustodyContext);
  if (!custody) throw new Error('AppNavigator must be rendered inside AppContainer.');
  const navigation = useNavigation<NavigationContainerRef<RootRoutes>>();
  const identityNavigation = useRef<IdentityNavigation | undefined>(undefined);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  useEffect(() => {
    const update = () => setSensorsOpen(sensorTabFocused(navigation.getRootState()));
    const offState = navigation.addListener('state', update);
    const offReady = navigation.addListener('ready', update);
    update();
    return () => {
      offState();
      offReady();
    };
  }, [navigation]);
  const home = useCallback(() => {
    if (
      navigation.isReady() &&
      navigation.getCurrentRoute()?.name !== 'Tabs' &&
      (navigation.getRootState()?.routes.length ?? 0) > 1
    ) {
      navigation.dispatch(StackActions.popToTop());
      return;
    }
    const identity = identityNavigation.current;
    if (identity && identity.getState().routes.length > 1) identity.popToTop();
  }, [navigation]);
  const openFlow = useCallback(
    (flow: IdentityFlow) => {
      if (flow === 'phone' || flow === 'ssn') {
        identityNavigation.current?.navigate(flow === 'phone' ? 'PhoneDetail' : 'SSNDetail');
      } else {
        if (identityNavigation.current?.getState().index === 0) {
          identityNavigation.current.navigate(flow === 'license' ? 'LicenseDetail' : 'PassportDetail');
        }
        navigation.navigate(flowRoutes[flow]);
      }
    },
    [navigation],
  );
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
        <IdentityStack.Screen name="PassportDetail" options={{ title: t('hub.passport.title') }}>
          {() => <PassportResult configuration={configuration} workspace={workspace} focus="passport" />}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="FaceDetail" options={{ title: t('hub.face.title') }}>
          {() => <PassportResult configuration={configuration} workspace={workspace} focus="face" />}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="LicenseDetail" options={{ title: t('hub.licenseTitle') }}>
          {() => <LicenseResult configuration={configuration} workspace={workspace} />}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="SSNDetail" options={{ title: t('common.socialSecurityNumber') }}>
          {() => (
            <IdentityPrerequisiteGate reason={workspace.ssn.blocked} onExit={workspace.ssn.exit}>
              <SSNFlow
                configuration={workspace.phone.configuration}
                saved={workspace.ssn.input}
                onComplete={workspace.ssn.accept}
                onClaim={workspace.ssn.claim}
                onExit={workspace.ssn.exit}
              />
            </IdentityPrerequisiteGate>
          )}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="PhoneDetail" options={{ title: t('hub.phone.title') }}>
          {() => (
            <IdentityPrerequisiteGate reason={workspace.phone.blocked} onExit={workspace.phone.exit}>
              <PhoneFlow
                configuration={workspace.phone.configuration}
                saved={workspace.phone.input}
                onComplete={workspace.phone.accept}
                onClaim={workspace.phone.claim}
                onExit={workspace.phone.exit}
              />
            </IdentityPrerequisiteGate>
          )}
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
          <SettingsStack.Screen name="DeveloperChecks" options={{ title: t('developer.title') }}>
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
      <PageHeaderContext.Provider value="native">
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
      </PageHeaderContext.Provider>
    );
  }
  return (
    <SensorSession configuration={configuration} open={sensorsOpen}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs">{renderTabs}</Root.Screen>
        <Root.Group screenOptions={modal} screenLayout={modalLayout}>
          <Root.Screen name="PassportCapture">
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
          <Root.Screen name="LicenseCapture">
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
        </Root.Group>
      </Root.Navigator>
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
      onLicenseResult={() => navigation.navigate('LicenseDetail')}
      onPassportResult={(focus) => navigation.navigate(focus === 'face' ? 'FaceDetail' : 'PassportDetail')}
    />
  );
}
