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
  type NativeStackScreenProps,
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
import { AirCheckScreen } from '../fusion/AirCheckScreen';
import { ContinuityScreen } from '../fusion/ContinuityScreen';
import { DriverLicenseFlow } from '../identity/DriverLicenseFlow';
import { GlossaryScreen, OverTimeScreen, ThreeProofsScreen } from '../fusion/FusionExplanations';
import { type FusionDestination, FusionScreen } from '../fusion/FusionScreen';
import { IdentityCaptureFlow } from '../identity/IdentityCaptureFlow';
import { IdentityChooseID, type OnboardingDocument } from '../onboarding/IdentityChooseID';
import { IdentityEnvironmentCheck } from '../onboarding/IdentityEnvironmentCheck';
import { IdentityHome } from '../identity/IdentityHome';
import { IdentityLicenseFace } from '../onboarding/IdentityLicenseFace';
import { IdentityLicenseFlow } from '../onboarding/IdentityLicenseFlow';
import { IdentityPreparation } from '../onboarding/IdentityPreparation';
import { IdentityPrerequisiteGate } from './IdentityPrerequisiteGate';
import { IdentityRecovery } from '../identity/IdentityRecovery';
import { LicenseResult, PassportResult } from '../identity/IdentityResults';
import { IdentitySettings } from '../identity/IdentitySettings';
import { IdentityVerificationDetail, type VerificationSection } from '../onboarding/IdentityVerificationDetail';
import { IdentityVerificationResult } from '../onboarding/IdentityVerificationResult';
import { IdentityWelcome } from '../onboarding/IdentityWelcome';
import { IntegrationChecks } from './IntegrationChecks';
import { t } from '../locales/i18n';
import { PhoneFlow } from '../identity/PhoneFlow';
import { SensorDocumentationScreen } from '../sensors/SensorBoardDocuments';
import { copy, type SensorPage, title } from '../sensors/SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession } from '../sensors/SensorScreen';
import { SSNFlow } from '../identity/SSNFlow';
import { ControllerCustodyContext } from '../ui/ControllerCustody';
import { PageHeaderContext } from '../ui/Page';
import { symbol } from '../ui/tokens.generated';
import { type IdentityFlow, useIdentityWorkspace } from './useIdentityWorkspace';

/** The main application's tabs and full-screen checks. AppContainer owns the navigation root. */
type RootRoutes = {
  Tabs: undefined;
  PassportCapture: undefined;
  LicenseCapture: { guided: true } | undefined;
  IdentitySSN: undefined;
  IdentityEnvironment: undefined;
  IdentityVerificationResult: undefined;
  IdentityVerificationDetail: { section: VerificationSection };
  IdentityPhone: undefined;
  IdentityLicenseFace: undefined;
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
  IdentityWelcome: undefined;
  IdentityChooseID: undefined;
  IdentityPreparation: { document: OnboardingDocument };
  PassportDetail: undefined;
  FaceDetail: undefined;
  LicenseDetail: undefined;
  PhoneDetail: undefined;
  SSNDetail: undefined;
};
type SensorRoutes = {
  SensorBoard: undefined;
  SensorDetail: { page: SensorPage };
  SensorDocumentation: { page: SensorPage };
};
type SettingsRoutes = { SettingsHome: undefined; DeveloperChecks: undefined };
type FusionRoutes = { FusionHome: undefined; OverTime: undefined } & {
  [Page in FusionDestination]: undefined;
};
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
  licenseFace: 'IdentityLicenseFace',
  environment: 'IdentityEnvironment',
  verificationResult: 'IdentityVerificationResult',
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
  if (!custody) throw new Error('APP_CONTAINER_REQUIRED');
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
    // Closing the completed journey returns to Identity L1. Earlier capture exits retain
    // their originating detail/preparation route so Back can resume the current task.
    if (navigation.getCurrentRoute()?.name === 'IdentityVerificationResult') {
      identityNavigation.current?.popToTop();
    }
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
    (flow: IdentityFlow, guided = false) => {
      const nextGuided = guidedFlowRoute(flow, guided);
      if (nextGuided) {
        navigation.dispatch(StackActions.replace(nextGuided));
        return;
      }
      if (flow === 'phone' || flow === 'ssn') {
        identityNavigation.current?.navigate(flow === 'phone' ? 'PhoneDetail' : 'SSNDetail');
        return;
      }
      if (identityNavigation.current?.getState().index === 0) {
        identityNavigation.current.navigate(flow === 'license' ? 'LicenseDetail' : 'PassportDetail');
      }
      if (flow === 'license') navigation.navigate('LicenseCapture', guided ? { guided: true } : undefined);
      else navigation.navigate(flowRoutes[flow]);
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
        <IdentityStack.Screen name="IdentityWelcome" options={{ title: t('onboarding.title') }}>
          {({ navigation: identity }: NativeStackScreenProps<IdentityRoutes, 'IdentityWelcome'>) => (
            <IdentityWelcome onStart={() => identity.navigate('IdentityChooseID')} />
          )}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="IdentityChooseID" options={{ title: t('onboarding.choose.title') }}>
          {({ navigation: identity }: NativeStackScreenProps<IdentityRoutes, 'IdentityChooseID'>) => (
            <IdentityChooseID
              onContinue={(document) => identity.navigate('IdentityPreparation', { document })}
            />
          )}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="IdentityPreparation" options={{ title: t('onboarding.title') }}>
          {({ route }: NativeStackScreenProps<IdentityRoutes, 'IdentityPreparation'>) => (
            <IdentityPreparation
              document={route.params.document}
              captureDisabled={workspace.passport.openingResults || workspace.recovery.clearing}
              {...(route.params.document === 'license'
                ? {
                    onCapture: () =>
                      workspace.license.start(
                        workspace.license.result && !workspace.license.result.document.back
                          ? 'back'
                          : 'front',
                        true,
                      ),
                  }
                : {})}
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
          {({ route, navigation: sensors }: NativeStackScreenProps<SensorRoutes, 'SensorDetail'>) => (
            <SensorDetailScreen
              page={route.params.page}
              onOpenDocumentation={() => sensors.navigate('SensorDocumentation', { page: route.params.page })}
            />
          )}
        </SensorStack.Screen>
        <SensorStack.Screen name="SensorDocumentation" options={{ title: t('sensors.docs.open') }}>
          {({ route }) => <SensorDocumentationScreen page={route.params.page} />}
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
              configuration={configuration}
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
            {({ route }: NativeStackScreenProps<RootRoutes, 'LicenseCapture'>) => {
              const Flow = route.params?.guided ? IdentityLicenseFlow : DriverLicenseFlow;
              return (
                <Flow
                  configuration={configuration}
                  {...workspace.license.input}
                  onComplete={workspace.license.accept}
                  {...(route.params?.guided ? { onContinue: workspace.license.continueToPhone } : {})}
                  onClaim={workspace.license.claim}
                  onExit={workspace.license.exit}
                />
              );
            }}
          </Root.Screen>
          <Root.Screen name="IdentityPhone">
            {() => (
              <IdentityPrerequisiteGate reason={workspace.phone.blocked} onExit={workspace.phone.exit}>
                <PhoneFlow
                  configuration={workspace.phone.configuration}
                  saved={workspace.phone.input}
                  guided
                  onContinue={workspace.phone.continueToFace}
                  onComplete={workspace.phone.accept}
                  onClaim={workspace.phone.claim}
                  onExit={workspace.phone.exit}
                />
              </IdentityPrerequisiteGate>
            )}
          </Root.Screen>
          <Root.Screen name="IdentitySSN">
            {() => (
              <IdentityPrerequisiteGate reason={workspace.ssn.blocked} onExit={workspace.ssn.exit}>
                <SSNFlow
                  configuration={workspace.phone.configuration}
                  saved={workspace.ssn.input}
                  guided
                  onContinue={workspace.ssn.continueToEnvironment}
                  onComplete={workspace.ssn.accept}
                  onClaim={workspace.ssn.claim}
                  onExit={workspace.ssn.exit}
                />
              </IdentityPrerequisiteGate>
            )}
          </Root.Screen>
          <Root.Screen name="IdentityEnvironment">
            {() =>
              workspace.environment.input ? (
                <IdentityEnvironmentCheck
                  saved={workspace.environment.input}
                  onClaim={workspace.environment.claim}
                  onComplete={workspace.environment.accept}
                  onExit={workspace.environment.exit}
                  beforeFinish={workspace.environment.prepareReview}
                  onFinish={workspace.environment.finish}
                />
              ) : null
            }
          </Root.Screen>
          <Root.Screen name="IdentityVerificationResult">
            {() =>
              workspace.verification.result ? (
                <IdentityVerificationResult
                  result={workspace.verification.result}
                  onDetails={(section) => navigation.navigate('IdentityVerificationDetail', { section })}
                  onExit={workspace.verification.exit}
                />
              ) : null
            }
          </Root.Screen>
          <Root.Screen
            name="IdentityVerificationDetail"
            options={({ route }) => ({
              ...pushed,
              presentation: 'card',
              title: t(`onboarding.result.${route.params.section}`),
            })}
          >
            {({ route }: NativeStackScreenProps<RootRoutes, 'IdentityVerificationDetail'>) =>
              workspace.verification.review ? (
                <PageHeaderContext.Provider value="native">
                  <IdentityVerificationDetail
                    section={route.params.section}
                    review={workspace.verification.review}
                  />
                </PageHeaderContext.Provider>
              ) : null
            }
          </Root.Screen>
          <Root.Screen name="IdentityLicenseFace">
            {() =>
              workspace.face.input ? (
                <IdentityLicenseFace
                  {...workspace.face.input}
                  onContinue={workspace.face.continueToSSN}
                  onClaim={workspace.face.claim}
                  onComplete={workspace.face.accept}
                  onExit={workspace.face.exit}
                />
              ) : null
            }
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
}: Omit<ComponentProps<typeof IdentityHome>, 'onWelcome' | 'onLicenseResult' | 'onPassportResult'> & {
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
      onWelcome={() => navigation.navigate('IdentityWelcome')}
      onLicenseResult={() => navigation.navigate('LicenseDetail')}
      onPassportResult={(focus) => navigation.navigate(focus === 'face' ? 'FaceDetail' : 'PassportDetail')}
    />
  );
}

function guidedFlowRoute(flow: IdentityFlow, guided: boolean) {
  if (flow === 'licenseFace') return 'IdentityLicenseFace';
  if (flow === 'environment') return 'IdentityEnvironment';
  if (flow === 'verificationResult') return 'IdentityVerificationResult';
  if (flow === 'phone' && guided) return 'IdentityPhone';
  if (flow === 'ssn' && guided) return 'IdentitySSN';
  return undefined;
}
