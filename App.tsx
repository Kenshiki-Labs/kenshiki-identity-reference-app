import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
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
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, useColorScheme } from 'react-native';
import { CaptureFlowController, type CompletedCapture } from './CaptureFlowController';
import { DocumentCheckPanel } from './DocumentCheckPanel';
import { isCompleteDocument, type SavedDocumentCapture } from './DocumentFlowController';
import { DocumentResultDetails, DriverLicenseFlow, documentName } from './DriverLicenseFlow';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { Action, CaptureResultDetails, IdentityCaptureFlow, styles } from './IdentityCaptureFlow';
import { IntegrationChecks } from './IntegrationChecks';
import { t } from './locales/i18n';
import { PhoneFlow } from './PhoneFlow';
import type { SavedPhoneCheck } from './PhoneFlowController';
import { phoneCheckStopped } from './PhonePolicy';
import { copy, type SensorPage, title } from './SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession, SensorSettingsScreen } from './SensorScreen';
import { SSNFlow, ssnSummary } from './SSNFlow';
import type { SavedSSNCheck } from './SSNFlowController';
import { BarButton, ListRow, ListSection } from './ui/List';
import type { CancelHandle } from './ui/ModalCancel';
import { NativeSheet, useConfirmation } from './ui/NativeSheet';
import { appearanceColor, color, symbol } from './ui/tokens.generated';
import { Wordmark } from './ui/Wordmark';

const clearErrors: ErrorText = {
  busy: t('hub.clearError.busy'),
  sessionUnavailable: t('hub.clearError.sessionUnavailable'),
  resultsNotConfigured: t('hub.clearError.resultsNotConfigured'),
  resultIntegrityFailure: t('hub.clearError.resultIntegrityFailure'),
  documentCustodyFailed: t('hub.clearError.documentCustodyFailed'),
  storageUnavailable: t('hub.clearError.storageUnavailable'),
};
const restoreErrors: ErrorText = {
  sessionUnavailable: t('hub.restoreError.sessionUnavailable'),
  busy: t('hub.restoreError.busy'),
};

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
/** Three tabs in a native UITabBar, each its own native stack with a large title. */
type TabRoutes = { IdentityTab: undefined; SensorsTab: undefined; SettingsTab: undefined };
type IdentityRoutes = { IdentityHome: undefined; PassportResult: undefined; LicenseResult: undefined };
type SensorRoutes = { SensorBoard: undefined; SensorDetail: { page: SensorPage } };
type SettingsRoutes = { SettingsHome: undefined; DeveloperChecks: undefined };
const Root = createNativeStackNavigator<RootRoutes>();
const Tabs = createNativeBottomTabNavigator<TabRoutes>();
const IdentityStack = createNativeStackNavigator<IdentityRoutes>();
const SensorStack = createNativeStackNavigator<SensorRoutes>();
const SettingsStack = createNativeStackNavigator<SettingsRoutes>();
type IdentityNavigation = NativeStackNavigationProp<IdentityRoutes>;
type ClearTarget = 'passport' | 'document';
/** iOS 26 draws its own scroll edge effect under a transparent navigation bar. A blur added on top
 * of it overlaps it and covers the large title, so the bar's blur is only for earlier iOS. */
const scrollEdgeEffects = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
const pushed: NativeStackNavigationOptions = {
  headerTransparent: true,
  ...(scrollEdgeEffects ? {} : { headerBlurEffect: 'systemChromeMaterial' as const }),
  contentStyle: { backgroundColor: color.background },
};
const large: NativeStackNavigationOptions = { headerLargeTitle: true, headerLargeTitleShadowVisible: false };
/** The brand's wordmark in the bar row above the Identity tab's large title. */
const branded: NativeStackNavigationOptions = {
  unstable_headerLeftItems: () => [{ type: 'custom', element: <Wordmark />, hidesSharedBackground: true }],
};

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

const emptyConfiguration: Configuration = {};
/** `developerChecks` is passed only by the simulator Debug AppDelegate. `configurationIssue` names
 * a native configuration step that failed before React mounted. */
export default function App({
  configuration = emptyConfiguration,
  developerChecks = false,
  configurationIssue,
}: {
  configuration?: Configuration | undefined;
  developerChecks?: boolean | undefined;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
}) {
  const navigation = useNavigationContainerRef<RootRoutes>();
  const identityNavigation = useRef<IdentityNavigation | undefined>(undefined);
  const scheme = useColorScheme();
  const cancel = useRef<(() => void) | undefined>(undefined);
  const cancelHandle: CancelHandle = cancel;
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const [result, setResult] = useState<CompletedCapture>();
  const [focus, setFocus] = useState<'passport' | 'face'>('passport');
  const owned = useRef<CompletedCapture | undefined>(undefined);
  const [input, setInput] = useState<{
    completed?: CompletedCapture | undefined;
    resume?: ('read' | 'selfie') | undefined;
  }>({});
  const [document, setDocument] = useState<SavedDocumentCapture>();
  const ownedDocument = useRef<SavedDocumentCapture | undefined>(undefined);
  const [documentInput, setDocumentInput] = useState<{
    saved?: SavedDocumentCapture | undefined;
    resume?: ('front' | 'back') | undefined;
  }>({});
  const [ssn, setSSN] = useState<SavedSSNCheck>();
  const ownedSSN = useRef<SavedSSNCheck | undefined>(undefined);
  const [ssnInput, setSSNInput] = useState<SavedSSNCheck>();
  const [phone, setPhone] = useState<SavedPhoneCheck>();
  const ownedPhone = useRef<SavedPhoneCheck | undefined>(undefined);
  const [phoneInput, setPhoneInput] = useState<SavedPhoneCheck>();
  const [confirmingClear, setConfirmingClear] = useState<ClearTarget>();
  const [clearFailure, setClearFailure] = useState<{ target: ClearTarget; message: string }>();
  const [clearing, setClearing] = useState(false);
  const [openingResults, setOpeningResults] = useState(!!configuration.results);
  const [savedCount, setSavedCount] = useState(0);
  const [restoreFailure, setRestoreFailure] = useState<string>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const latestRestoreAttempt = useRef(0);
  const releasing = useRef<Promise<unknown>>(Promise.resolve());
  /** Back to the Identity list: closes a presented check and pops the Identity tab's pushed screens. */
  function home() {
    if (navigation.isReady() && navigation.canGoBack()) navigation.dispatch(StackActions.popToTop());
    const identity = identityNavigation.current;
    if (identity && identity.getState().routes.length > 1) identity.popToTop();
  }
  // One configuration is one holder's custody. Before the next holder's saved results open,
  // release every session the previous holder's screens own, clear their personal state and
  // return to the Identity list.
  useEffect(() => {
    const previous = [
      owned.current?.session,
      ownedDocument.current?.session,
      ownedSSN.current?.session,
      ownedPhone.current?.session,
    ];
    owned.current = undefined;
    ownedDocument.current = undefined;
    ownedSSN.current = undefined;
    ownedPhone.current = undefined;
    setResult(undefined);
    setDocument(undefined);
    setSSN(undefined);
    setPhone(undefined);
    setInput({});
    setDocumentInput({});
    setSSNInput(undefined);
    setPhoneInput(undefined);
    setConfirmingClear(undefined);
    setClearFailure(undefined);
    setSavedCount(0);
    setRestoreFailure(undefined);
    if (navigation.isReady() && navigation.canGoBack()) navigation.dispatch(StackActions.popToTop());
    const identity = identityNavigation.current;
    if (identity && identity.getState().routes.length > 1) identity.popToTop();
    setOpeningResults(!!configuration.results);
    releasing.current = Promise.all(previous.flatMap((session) => (session ? [session.release()] : [])));
    releasing.current.catch(() => setRestoreFailure(t('hub.closeFailed.previous')));
  }, [configuration, navigation]);
  useEffect(() => {
    if (!configuration.results) {
      setOpeningResults(false);
      return;
    }
    let active = true;
    latestRestoreAttempt.current = restoreAttempt;
    const attempt = restoreAttempt;
    const isActive = () => active && latestRestoreAttempt.current === attempt;
    const controller = new CaptureFlowController(IdentityCaptureSession.create, configuration, () => {});
    setOpeningResults(true);
    const reportRestoreFailure = (error: unknown) => {
      if (isActive())
        setRestoreFailure(errorText(errorCode(error), restoreErrors, t('hub.restoreError.other')));
    };
    async function adoptRestoredResult() {
      if (controller.state.passport) {
        const restored = await controller.handoff();
        if (!isActive()) {
          await restored.session.release();
          return;
        }
        owned.current = restored;
        setResult(restored);
      }
    }
    const restore = async () => {
      try {
        await releasing.current;
        if (!isActive()) return;
        await controller.open();
        if (!isActive()) return;
        const sheet = controller.state.sheet;
        if (sheet) {
          setRestoreFailure(sheet.message);
          return;
        }
        setSavedCount(controller.state.saved?.length ?? (controller.state.passport ? 1 : 0));
        await adoptRestoredResult();
        setRestoreFailure(undefined);
      } catch (error) {
        reportRestoreFailure(error);
      } finally {
        await controller.dispose();
        if (isActive()) setOpeningResults(false);
      }
    };
    restore().catch(reportRestoreFailure);
    return () => {
      active = false;
      controller.dispose().catch(reportRestoreFailure);
    };
  }, [configuration, restoreAttempt]);
  useEffect(
    () => () => {
      owned.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedDocument.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedSSN.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedPhone.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
    },
    [],
  );
  function accept(completed: CompletedCapture) {
    owned.current = completed;
    setResult(completed);
    setInput({});
    home();
  }
  function start(resume?: 'read' | 'selfie') {
    const completed = result;
    owned.current = undefined;
    setResult(undefined);
    setInput({ completed, resume });
    navigation.navigate('PassportCapture');
  }
  async function openSavedResults() {
    if (openingResults) return;
    setOpeningResults(true);
    try {
      await owned.current?.session.release();
      owned.current = undefined;
      setResult(undefined);
      setInput({});
      navigation.navigate('PassportCapture');
    } finally {
      setOpeningResults(false);
    }
  }
  function acceptDocument(saved: SavedDocumentCapture) {
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    home();
  }
  function startDocument(resume?: 'front' | 'back') {
    const saved = document;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setDocumentInput({ saved, resume });
    navigation.navigate('LicenseCapture');
  }
  function openSSN() {
    ownedSSN.current = undefined;
    setSSNInput(ssn);
    setSSN(undefined);
    navigation.navigate('SSNCheck');
  }
  function acceptSSN(value: SavedSSNCheck) {
    ownedSSN.current = value;
    setSSN(value);
    setSSNInput(undefined);
    home();
  }
  function openPhone() {
    ownedPhone.current = undefined;
    setPhoneInput(phone);
    setPhone(undefined);
    navigation.navigate('PhoneCheck');
  }
  function acceptPhone(value: SavedPhoneCheck) {
    ownedPhone.current = value;
    setPhone(value);
    setPhoneInput(undefined);
    home();
  }
  /** Deleting saved evidence is a destructive choice: it is asked with the iOS action sheet. */
  function requestClear(target: ClearTarget) {
    setClearFailure(undefined);
    setConfirmingClear(target);
  }
  async function clear(target: ClearTarget) {
    if (clearing) return;
    setClearing(true);
    try {
      if (target === 'document') {
        await ownedDocument.current?.session.eraseDocuments();
        await ownedDocument.current?.session.release();
        ownedDocument.current = undefined;
        setDocument(undefined);
      } else {
        // An unreadable store has no review session; erase it through a session of its own.
        const review = owned.current?.session;
        const session = review ?? (await IdentityCaptureSession.create(configuration));
        try {
          if (configuration.results) await session.eraseResults();
        } catch (error) {
          if (!review) await session.release();
          throw error;
        }
        await session.release();
        owned.current = undefined;
        setResult(undefined);
        setSavedCount(0);
        setRestoreFailure(undefined);
      }
      setClearFailure(undefined);
      home();
    } catch (error) {
      reportClearFailure(target, error);
    } finally {
      setClearing(false);
    }
  }
  function reportClearFailure(target: ClearTarget, error: unknown) {
    setClearFailure({ target, message: errorText(errorCode(error), clearErrors, t('hub.clearError.other')) });
  }
  useConfirmation(
    confirmingClear
      ? {
          key: confirmingClear,
          title: confirmingClear === 'document' ? t('hub.clear.licenseTitle') : t('hub.clear.passportTitle'),
          message: confirmingClear === 'document' ? t('hub.clear.licenseBody') : t('hub.clear.passportBody'),
          confirm:
            confirmingClear === 'document' ? t('hub.clear.deleteLicenseScans') : t('hub.action.clearResults'),
          keep: t('hub.clear.keep'),
          onConfirm: () => {
            setConfirmingClear(undefined);
            clear(confirmingClear).catch((error: unknown) => reportClearFailure(confirmingClear, error));
          },
          onKeep: () => setConfirmingClear(undefined),
        }
      : undefined,
  );
  const passportReady = !!configuration.trustAnchorsURL;
  const faceReady = !!configuration.embedderURL && !!configuration.detectorURL;
  const blocked = openingResults || !!restoreFailure;
  const passportDisabled = blocked || (!passportReady && !result && !savedCount);
  const faceDisabled =
    blocked ||
    !(result?.comparison || (faceReady && result?.passport.portraitAvailable) || (!result && savedCount > 0));
  const covered = !!clearFailure || !!restoreFailure;
  const modal = (heading: string): NativeStackNavigationOptions => ({
    presentation: 'fullScreenModal',
    gestureEnabled: false,
    headerShown: true,
    title: heading,
    contentStyle: { backgroundColor: color.background },
    headerLeft: () => (
      <BarButton label={t('common.cancel')} testID="modal-cancel" onPress={() => cancel.current?.()} />
    ),
  });
  /** Why a dimmed check cannot open, for the section footer. Nothing while results are opening. */
  function unavailableReasons() {
    if (blocked) return undefined;
    const reasons = [
      passportDisabled ? t('hub.passport.notSetUp') : undefined,
      faceDisabled ? (faceReady ? t('hub.face.needsPassport') : t('hub.face.notSetUp')) : undefined,
    ].filter((reason): reason is string => !!reason);
    return reasons.length ? reasons.join(' ') : undefined;
  }
  function renderIdentity({ navigation: identity }: { navigation: IdentityNavigation }) {
    identityNavigation.current = identity;
    const saved = !!configuration.results && !!result;
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        testID="identity-hub"
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {configurationIssue === 'holderScopeUnreadable' && (
          <Text style={styles.label} testID="configuration-issue">
            {t('hub.configurationIssue')}
          </Text>
        )}
        <ListSection header={t('hub.section.checks')} footer={unavailableReasons()} icons>
          <ListRow
            rowID="open-driver-license"
            label={t('hub.license.title')}
            status={licenseSummary()}
            icon={{ name: symbol.license, background: color.swiftBlue }}
            onPress={() =>
              document && isCompleteDocument(document.document)
                ? identity.navigate('LicenseResult')
                : startDocument()
            }
          />
          <ListRow
            rowID="open-capture-flow"
            label={t('hub.passport.title')}
            status={passportDisabled && !blocked ? t('hub.notAvailable') : passportSummary()}
            icon={{ name: symbol.passport, background: color.swiftIndigo }}
            disabled={passportDisabled}
            onPress={() => {
              setFocus('passport');
              if (result) identity.navigate('PassportResult');
              else start();
            }}
          />
          <ListRow
            rowID="face-match-card"
            label={t('hub.face.title')}
            status={faceDisabled && !blocked ? t('hub.notAvailable') : faceSummary()}
            icon={{ name: symbol.face, background: color.swiftGreen }}
            disabled={faceDisabled}
            onPress={() => {
              setFocus('face');
              if (result?.comparison) identity.navigate('PassportResult');
              else start(result ? 'selfie' : undefined);
            }}
          />
          <ListRow
            rowID="open-ssn"
            label={t('common.socialSecurityNumber')}
            status={ssnStatus()}
            icon={{ name: symbol.ssn, background: color.swiftOrange }}
            onPress={openSSN}
          />
          <ListRow
            rowID="open-phone"
            label={t('hub.phone.title')}
            status={phoneStatus()}
            icon={{ name: symbol.phone, background: color.swiftTeal }}
            onPress={openPhone}
          />
        </ListSection>
        {saved && (
          <ListSection header={t('hub.section.saved')} footer={t('hub.action.savedNotice')} icons>
            <ListRow
              label={t('hub.action.openSavedPassportChecks')}
              icon={{ name: symbol.savedChecks, background: color.swiftGray }}
              disabled={openingResults}
              onPress={() => {
                openSavedResults().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
              }}
            />
          </ListSection>
        )}
      </ScrollView>
    );
  }
  function renderSettings({
    navigation: settings,
  }: {
    navigation: NativeStackNavigationProp<SettingsRoutes>;
  }) {
    const erasable = !!result || !!document;
    return (
      <SensorSettingsScreen>
        <ListSection header={t('settings.identityData')} footer={t('hub.action.savedNotice')} icons>
          {result && (
            <ListRow
              label={t('hub.action.eraseAll')}
              destructive
              chevron={false}
              icon={{ name: symbol.erase, background: color.swiftRed }}
              onPress={() => requestClear('passport')}
            />
          )}
          {document && (
            <ListRow
              label={t('hub.action.deleteLicenseScans')}
              destructive
              chevron={false}
              icon={{ name: symbol.erase, background: color.swiftRed }}
              onPress={() => requestClear('document')}
            />
          )}
        </ListSection>
        {!erasable && <Text style={styles.label}>{t('settings.nothingSaved')}</Text>}
        {developerChecks && __DEV__ && (
          <ListSection header={t('settings.developer')} icons>
            <ListRow
              rowID="open-sdk-checks"
              label={t('hub.action.developerChecks')}
              icon={{ name: symbol.developer, background: color.swiftGray }}
              onPress={() => settings.navigate('DeveloperChecks')}
            />
          </ListSection>
        )}
      </SensorSettingsScreen>
    );
  }
  function renderLicenseResult() {
    if (!document) return null;
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <DocumentResultDetails result={document} />
        <DocumentCheckPanel
          key={document.document.front?.captureID}
          session={document.session}
          configured={!!configuration.document?.check}
        />
        <Action
          label={t('license.retake')}
          secondary
          testID="retake-saved-document"
          onPress={() => startDocument('front')}
        />
        <Action
          label={t('hub.action.deleteLicenseScans')}
          destructive
          onPress={() => requestClear('document')}
        />
      </ScrollView>
    );
  }
  function renderPassportResult() {
    if (!result) return null;
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <CaptureResultDetails result={result} focus={focus} />
        <Action
          label={result.comparison ? t('passport.action.retakeSelfie') : t('passport.action.compareSelfie')}
          secondary
          disabled={!result.passport.portraitAvailable || !faceReady}
          onPress={() => start('selfie')}
        />
        {!faceReady && <Text style={styles.label}>{t('hub.face.notSetUp')}</Text>}
        <Action
          label={t('passport.action.readChipAgain')}
          secondary
          disabled={!passportReady}
          onPress={() => start('read')}
        />
        <Action label={t('hub.action.clearResults')} destructive onPress={() => requestClear('passport')} />
      </ScrollView>
    );
  }
  function licenseSummary() {
    if (!document) return t('hub.license.start');
    return isCompleteDocument(document.document)
      ? t('hub.license.viewResults', { name: documentName(document.document) })
      : t('hub.license.continueBack');
  }
  function passportSummary() {
    if (result) {
      return t('hub.passport.viewResults', {
        givenNames: result.passport.givenNames,
        surname: result.passport.surname,
      });
    }
    if (openingResults) {
      return t('common.openingSavedResults');
    }
    if (savedCount) {
      return t('hub.passport.openSaved');
    }
    return t('hub.passport.start');
  }
  function faceSummary() {
    if (result?.comparison) {
      return t('hub.face.viewResults');
    }
    if (!result && savedCount) {
      return t('hub.face.chooseSaved');
    }
    return t('hub.face.start');
  }
  function ssnStatus() {
    if (ssn?.snapshot.recoveryNeeded) return t('hub.ssn.needsAttention');
    if (ssn?.snapshot.receipt) return t('hub.ssn.viewResult', { summary: ssnSummary(ssn.snapshot.receipt) });
    return t('hub.ssn.start');
  }
  function phoneStatus() {
    if (phone?.snapshot.pending) return t('hub.phone.resume');
    if (!phone?.snapshot.receipt) return t('hub.phone.start');
    return phoneCheckStopped(phone.snapshot.receipt) ? t('hub.phone.stopped') : t('hub.phone.viewResult');
  }
  function renderIdentityTab() {
    return (
      <IdentityStack.Navigator screenOptions={pushed}>
        <IdentityStack.Screen name="IdentityHome" options={{ ...large, ...branded, title: t('hub.title') }}>
          {renderIdentity}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="PassportResult" options={{ title: t('hub.resultsTitle') }}>
          {renderPassportResult}
        </IdentityStack.Screen>
        <IdentityStack.Screen name="LicenseResult" options={{ title: t('hub.licenseTitle') }}>
          {renderLicenseResult}
        </IdentityStack.Screen>
      </IdentityStack.Navigator>
    );
  }
  function renderSensorsTab() {
    return (
      <SensorStack.Navigator screenOptions={pushed}>
        <SensorStack.Screen name="SensorBoard" options={{ ...large, title: copy('tab.sensors.title') }}>
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
        <SettingsStack.Screen name="SettingsHome" options={{ ...large, title: copy('tab.settings.title') }}>
          {renderSettings}
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
          <Root.Screen name="PassportCapture" options={modal(t('hub.passport.title'))}>
            {() => (
              <IdentityCaptureFlow
                configuration={configuration}
                {...input}
                cancelRef={cancelHandle}
                onComplete={accept}
                onExit={() => {
                  setInput({});
                  home();
                }}
              />
            )}
          </Root.Screen>
          <Root.Screen name="LicenseCapture" options={modal(t('hub.license.title'))}>
            {() => (
              <DriverLicenseFlow
                configuration={configuration}
                {...documentInput}
                cancelRef={cancelHandle}
                onComplete={acceptDocument}
                onExit={() => {
                  setDocumentInput({});
                  home();
                }}
              />
            )}
          </Root.Screen>
          <Root.Screen name="SSNCheck" options={modal(t('common.socialSecurityNumber'))}>
            {() => (
              <SSNFlow
                configuration={configuration}
                saved={ssnInput}
                cancelRef={cancelHandle}
                onComplete={acceptSSN}
                onExit={() => {
                  setSSNInput(undefined);
                  home();
                }}
              />
            )}
          </Root.Screen>
          <Root.Screen name="PhoneCheck" options={modal(t('hub.phone.title'))}>
            {() => (
              <PhoneFlow
                configuration={configuration}
                saved={phoneInput}
                cancelRef={cancelHandle}
                onComplete={acceptPhone}
                onExit={() => {
                  setPhoneInput(undefined);
                  home();
                }}
              />
            )}
          </Root.Screen>
        </Root.Navigator>
      </NavigationContainer>
      {restoreFailure && !clearFailure && (
        <NativeSheet testID="restore-bottom-sheet">
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('hub.restore.title')}
          </Text>
          <Text style={styles.body}>{t('hub.restore.body', { reason: restoreFailure })}</Text>
          <Action
            label={t('hub.restore.reopen')}
            disabled={openingResults}
            onPress={() => setRestoreAttempt((value) => value + 1)}
          />
          {configuration.results && (
            <Action
              label={t('hub.restore.erase')}
              destructive
              disabled={openingResults}
              testID="erase-unreadable-results"
              onPress={() => requestClear('passport')}
            />
          )}
        </NativeSheet>
      )}
      {clearFailure && (
        <NativeSheet testID="clear-bottom-sheet">
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('hub.clear.failedTitle')}
          </Text>
          <Text style={styles.body}>{clearFailure.message}</Text>
          <Action
            label={t('common.tryAgain')}
            onPress={() => clear(clearFailure.target)}
            disabled={clearing}
          />
          <Action
            label={t('hub.clear.keep')}
            secondary
            onPress={() => setClearFailure(undefined)}
            disabled={clearing}
          />
        </NativeSheet>
      )}
    </SensorSession>
  );
}
