# React Native iOS reference app — 0.6.0

Start here to run an independent app against the delivered SDK. You need both
`kenshiki-identity-capture-0.6.0.tgz` and `kenshiki-identity-capture-0.6.0-reference-ui.zip` from
the same build. Their accompanying `SHA256SUMS` identifies the exact bytes; the
[SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md) explains verification.
The generator installs the binary tarball; it does not require an SDK source checkout.
This is editable reference UI for the adopting team, not a finished SSA enrollment app. What it
leaves to the SSA app is listed under [Decisions for the SSA app](#decisions-for-the-ssa-app).

The baseline is **bare React Native 0.87.1, React 19.2.3, New Architecture, iOS 18+**. Android,
Expo Go and other React Native versions are not validated by this example. The generated CLI
project may contain Android files; this SDK delivery and these instructions are iOS only.

## 1. Prepare a Mac

Install the full Xcode application, select it with `xcode-select`, finish its first-launch setup,
and install an iPhone simulator runtime in Xcode Settings. Install Python 3, Node 22.22.2 with npm,
Ruby, CocoaPods and the Ruby `xcodeproj` gem. Internet access is needed for npm and CocoaPods.
Run these in your terminal before generating the host:

```sh
python3 --version
node --version
npm --version
ruby --version
ruby -rxcodeproj -e 'puts Xcodeproj::VERSION'
pod --version
xcodebuild -version
xcrun simctl list devices available
```

The development environment inspected for this guide has Node 22.22.2, npm 10.9.7, Ruby 2.6.10,
CocoaPods 1.16.2, xcodeproj 1.27.0 and Xcode 26.6. That is an environment record, not a claim that
all earlier or later versions work. Retain the release's executed test receipts with its artifact
hashes; the [SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md#verification-and-acceptance)
explains their scope and acceptance limits.

React Native 0.87.1 declares Node `^22.13.0 || ^24.3.0 || >=26.0.0`. The generator enforces
those release ranges before creating a host; a minimum-only check would incorrectly admit Node 23,
25 and early 24 releases. Use the recorded 22.22.2 toolchain for reproducible validation. Acceptance
by the version check is not evidence that another Node release has passed this app's tests.

The generator invokes **`ruby` and `pod` directly from PATH**. Its Ruby must be able to load
`xcodeproj`; having the gem installed under a different Ruby is insufficient. If needed, install
`cocoapods` and `xcodeproj` with your chosen Ruby's gem manager. The CLI also creates a Gemfile;
this generator does not install or use that bundle. Do not mix `bundle exec pod` and direct `pod`
without first resolving and testing your team's toolchain.

## 2. Generate a new host

Place both delivered files in a release folder. Run the following from that folder, replacing
the host destination with a new absolute path. It must not exist yet. The application and Xcode
scheme are named `IdentitySDKHost` regardless of the destination directory name.

```sh
unzip kenshiki-identity-capture-0.6.0-reference-ui.zip
python3 Examples/ReactNativeCaptureHost/create-host.py \
  "$HOME/Developer/IdentitySDKHost" \
  "$PWD/kenshiki-identity-capture-0.6.0.tgz"
```

The script checks the package and tools, invokes the pinned React Native CLI, copies the UI and
tests, copies the tarball into the new host's `vendor` directory, installs npm dependencies,
configures the native targets and runs `pod install`. It refuses a tarball whose SHA-256 or SDK
commit differs from the archive's `integration-manifest.json`. Wait for `Independent host ready:`
before continuing.

Every delivered TypeScript module, including nested UI modules and test helpers, comes from the
integration manifest. The generator rejects missing, changed or linked modules before invoking the
CLI and copies the bytes it checked. Source-checkout SDK imports are rewritten to installed package
subpaths, including Jest mocks. Unlisted local TypeScript files are not copied.

Before creating anything, `create-host.py` also refuses a compiled model directory that contains no
files and a trust-anchor file without a PEM certificate block. These checks catch an empty or wrong
file; they do not show that a model or anchor set is the right one. Then it changes the generated
project as follows:

- `create-host.py` deletes the CLI's starter test `__tests__/App.test.tsx`, copies supplied
  resources into `ios/CaptureResources`, and sets the Podfile platform to iOS 18.0. It stops with an
  error if the generated Podfile lacks the line it replaces.
- `configure-host.rb` replaces `ios/IdentitySDKHost/AppDelegate.swift` with this example's; sets the
  camera, NFC, motion, Bluetooth and location (When In Use and Always) usage descriptions and the
  passport application identifier in `Info.plist`; merges NFC tag
  reading (`TAG`) into the app's existing entitlements file; adds `ios/CaptureResources` to the app
  when it exists; sets the deployment target to 18.0 and `FORCE_BUNDLING` on Debug; adds the
  `ArtifactIntegrationTests` UI-test target; and makes the scheme's test action run that target in
  Debug. Its `configure-native-tests.rb` helper also adds a separate `ArtifactNative` scheme with
  the `ArtifactNativeTests` unit bundle and a minimal UIKit host. That scheme links the installed
  XCFrameworks directly and starts no React UI, sensors or providers. It does not build, launch or publish an app. If generation fails after creating the
host, preserve the error output and use a new destination when retrying; it will not overwrite
an existing project.

For an existing SSA app, use the [package integration guide](../../ReactNative/identity-capture/README.md)
and copy only the desired UI source. The same guide is installed at
`node_modules/@kenshiki/identity-capture/README.md`; the package build checks that the installed copy
matches the reviewed guide byte for byte. Do not run `configure-host.rb`
against your existing app: it assumes the generated `IdentitySDKHost` target, replaces its
AppDelegate and rewrites its test scheme.

## 3. Build and run the simulator app

From the generated host root:

```sh
cd "$HOME/Developer/IdentitySDKHost"
npx --no-install tsc --noEmit
npx --no-install jest --runInBand
open ios/IdentitySDKHost.xcworkspace
```

Run these checks on the generated files without adding a mapper to the SDK checkout or editing
`node_modules`. The generated Jest configuration transforms the installed SDK's TypeScript and
the navigation dependencies; only `*.test.ts` and `*.test.tsx` files are suites. Compare Jest's
executed suite inventory with the reference-host tests in `integration-manifest.json`, including
the `ui/` and `locales/` suites. SDK package tests run separately in the source checkout and are
not shipped in the npm tarball. Keep the test results with the artifact hash; source-checkout
success does not establish that an independently generated host works.

For a recorded check of the exact installed files and suite inventory, use the generated harness:

```sh
python3 validate-installed-host.py "$PWD" --output /absolute/new/host-check \
  --simulator YOUR_SIMULATOR_UUID
```

It runs TypeScript and Jest, verifies discovered and executed suite paths against the delivery
manifest, checks every installed tarball file, and executes only the native `ArtifactNativeTests`
unit bundle. Omit `--simulator` for the JavaScript-only lane. The receipt records exact commands,
input hashes, counts and skips; it fails if installed inputs change during execution. The retained
`vendor/reference-sources.json` allows it to verify the generator's import rewrites against the
original manifest. Keep that file with the host's delivered tarball and manifest.

The native unit lane covers the public document-registration API, configuration refusal, consent
and missing-capture refusal. It uses no licence, identity document, supplier request, camera or UI
automation. A pass establishes installed native API execution, not a React-to-native journey or
successful vendor analysis. UI tests and physical acceptance remain separate lanes below.

In Xcode select the `IdentitySDKHost` scheme and an **iPhone simulator**. In Edit Scheme → Run,
set Build Configuration to **Release**, then Run. Release bundles JavaScript and needs no Metro
server. For Debug, set `IDENTITY_HOST_EMBEDDED_JAVASCRIPT=1` in the Run scheme's environment;
the generator embeds JavaScript in Debug too.
Open the `.xcworkspace`, not the `.xcodeproj`.

The generated app removes the CLI's local-network ATS exception. For live Metro development,
use a separate Debug-only Info.plist with `NSAllowsLocalNetworking=true`, assign it only to
Debug's `INFOPLIST_FILE`, leave `IDENTITY_HOST_EMBEDDED_JAVASCRIPT` unset and run `npm start`
from the host root. Release keeps the generated Info.plist with unrestricted loads disabled.

The app opens on a native tab bar: Fusion, Sensors, Identity and Settings, each its own navigation stack.
All four tabs use the same `Page` container for their header, branding and layout; native stacks own navigation transitions.
Fusion presents Air Check, Continuity, their native calculation terms, illustrative
Over Time projections, Three Proofs and Glossary. Fusion, Sensors and Settings share one session.
Air Check starts when its screen opens; continuity evaluation is explicit and evaluates the signed Sensors
reading without recapturing it. Forget continuity history requires confirmation and does not erase
unrelated evidence or replace keys. Local receipt verification is not server acceptance.

The Identity tab lists Driver's license, Passport, Face match, Social Security
number and Phone as inset grouped rows. No provider or personal data is required to open it. The
simulator host has no trust anchors or face models, so the Passport row is dimmed and the section
footer says passport chip checking is not set up; Face match is dimmed without both models, and
otherwise until a passport portrait exists. A row for saved results stays available to open them. Simulator camera/NFC/TrueDepth and text messaging are unavailable:
those workflows must show recovery, not a successful hardware check. Without a registered native
provider, SSN, phone and document checking remain explicitly unavailable. This is expected.

For the installed-package UI tests, choose an available iPhone simulator UUID from the command
below and replace `YOUR_SIMULATOR_UUID`. Run from the host root:

```sh
xcrun simctl list devices available
xcodebuild test -workspace ios/IdentitySDKHost.xcworkspace -scheme IdentitySDKHost \
  -configuration Debug -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UUID' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

The UI tests run the Debug configuration, because only a simulator Debug build offers the
developer checks two of them drive. `configure-host.rb` sets `FORCE_BUNDLING` on Debug, so the
JavaScript bundle is embedded and no Metro server is needed. The UI-test target's bundle
identifier is the app's bundle identifier followed by `.ArtifactIntegrationTests`; after changing
the app's identifier, run `configure-host.rb` on the host again to update it.

Keep simulator ad hoc signing enabled: the tests exercise actual Keychain-backed custody. Do not
reuse these signing flags for a physical iPhone. The reference app's **Developer checks** appear
only in Debug builds on a simulator; build Debug for a simulator to run them. They use their own
isolated stores, expect unavailable hardware and never run on a phone.

## 4. Enable physical capture and native services

Generate a separate device host with the resources supplied by your integration owner:

```sh
python3 Examples/ReactNativeCaptureHost/create-host.py \
  "$HOME/Developer/IdentitySDKDeviceHost" \
  "$PWD/kenshiki-identity-capture-0.6.0.tgz" \
  --trust-anchors /absolute/passport-master-list.pem \
  --embedder /absolute/embedder.mlmodelc \
  --detector /absolute/detector.mlmodelc
```

Run that command from the release folder used in step 2. The `.mlmodelc` inputs must be compiled
model directories compatible with the SDK, not arbitrary models or `.mlmodel` files. The PEM must
contain the intended passport trust anchors. These licensed/configured resources are **not included**
in the delivery. Request their compatible versions and provenance from your integration owner.
For U.S. passport device integration, this source checkout includes the existing U.S. CA bundle
at `passport-us/masterList.pem`. Pass that path with `--trust-anchors` when generating the device
host. `passport-us/provenance.json` pins its source and all seven certificate fingerprints.
This is a device-integration profile: original acquisition, signed master-list provenance and
current revocation coverage remain unverified. It is not a production trust-source approval.
Do not change the SDK's signature or trust-failure handling to make a passport pass.

To prepare the existing face models from this source checkout for device evaluation:

```sh
python3 Examples/ReactNativeCaptureHost/compile-face-resources.py /absolute/new/face-resources
```

The compiler verifies all six model-package files against the SDK's pinned import manifest,
compiles for iOS 18, and records the compiled resource hashes in `face-resources.json`.
Pass the resulting `embedder.mlmodelc` and `detector.mlmodelc` directories to `create-host.py`
using the flags above. Model thresholds and selfie admission policy are unchanged.
The models' existing [provenance and licensing limitations](../../ThirdParty/FaceMatching/Provenance/pulse-face-embedder-provenance.md)
still apply; compilation and installation do not establish production licensing or face-match accuracy.

The script copies them into `ios/CaptureResources`; AppDelegate resolves their bundle URLs and
passes them to the SDK explicitly. A trust result is only as appropriate as the supplied anchors.

Open the new workspace, give the app a unique test bundle identifier, select your Apple development
team and enable NFC Tag Reading for that app/provisioning profile. Or let the script do it: pass
`--bundle-identifier`, `--development-team` (automatic signing) and, for an app that attests to a
server, `--app-attest-environment development|production` to `create-host.py`. Set signing for the UI-test target
as well if testing on a device. Enable Developer Mode on the paired iPhone if Xcode requires it.
The script supplies camera/NFC usage descriptions, passport AID `A0000002471001` and TAG entitlement;
your team remains responsible for provisioning and product-appropriate permission copy.
Use a TrueDepth-equipped iPhone for selfie liveness. RGB-only hardware must fail closed. No
presentation-attack, false-match or false-non-match figures exist for this liveness check or the
face comparison.

Native service adapters are separate from hardware capture:

| Capability | What the adopting native team supplies |
| --- | --- |
| Document check | An adopter-owned `DocumentCheckProvider`; either the packaged native reader registration below or `IDCaptureRegisterDocumentCheckProvider` for an adopter-owned reader; `configuration.document.check` selects it |
| Bound SSN checks | `SSNVerificationProvider`, `IDCaptureRegisterSSNVerificationProvider`, a native context reference to the checked document/completed phone receipt, and dedicated custody |
| Phone | `PhoneCheckProvider`, `IDCaptureRegisterPhoneCheckProvider`, approved service, checked-document reference and custody configuration |
| Subscriber comparison | Optional separately qualified `SubscriberCheckProvider`, selected through `phone.subscriberProviderID` |

Ordinary AppDelegate launches register none of these services. JavaScript does not receive service
credentials. A card being present does not mean a live endpoint is ready. Three supplier dependencies
remain unresolved: live phone (storage, authorization and supplier qualification), the SSN supplier's
qualification including its retention, and the document-check supplier's qualification. Keep the
approved in-app text journey, and do not route it to the legacy backend as a shortcut. Follow the
detailed provider contracts in the [package integration guide](../../ReactNative/identity-capture/README.md),
including [what leaves the phone](../../ReactNative/identity-capture/README.md#what-leaves-the-phone).
Supplier non-retention requires independent qualification.

### Configure the packaged document reader

The runtime includes the pinned Regula reader adapter. Its licence, database and provenance are
adopter-owned inputs, supplied together when generating a host:

```sh
python3 Examples/ReactNativeCaptureHost/create-host.py \
  "$HOME/Developer/IdentitySDKDocumentHost" \
  "$PWD/kenshiki-identity-capture-0.6.0.tgz" \
  --regula-license /absolute/regula.license \
  --regula-database /absolute/db.dat \
  --regula-provenance /absolute/regula-provenance.json
```

The generator checks that all three files are nonempty and that provenance is a JSON object,
then copies them to `ios/CaptureResources/Regula`. These checks do not validate a licence or
qualify a database. Runtime resource verification checks the provenance schema, pinned analyzer
identity and database SHA-256 on the first consented fresh read. The three inputs are not included
in the SDK delivery. Merely copying them does not register a service, enable checking or dispatch
a request.

In the adopting native app, resolve that bundle directory and register its independently approved
service adapter before creating capture sessions. For example, given `resources`, an adopter-owned
`provider: any DocumentCheckProvider`, and the service's declared field allowlist and resource budgets:

```swift
import IdentityCapture
import IdentityCaptureRuntime

let reader = try RegulaDocumentConfiguration(
  licenseURL: resources.appendingPathComponent("regula.license"),
  databaseURL: resources.appendingPathComponent("db.dat"),
  provenanceURL: resources.appendingPathComponent("regula-provenance.json"),
  fieldTypes: allowedFieldTypes,
  maximumObservationBytes: observationByteBudget,
  maximumPortraitEncodedBytes: portraitByteBudget,
  maximumPortraitDecodedPixels: portraitPixelBudget)
try IDCaptureSharedRuntime().registerRegulaDocumentCheckProvider(
  provider, identifier: "adopter-document", configuration: reader)
document["check"] = ["providerID": "adopter-document", "recordDomain": "adopter-document-v1"]
```

Run registration on the main actor before mounting React. The immutable configuration accepts
only distinct local resource file URLs, a nonempty unique list of nonnegative field IDs, and positive
budgets. Registration does not hash the database or initialize the reader. The packaged reader
produces and retains its prepared-document and original-photo reports before the independent
service adapter may construct a request. In this registration mode `provider.readDocument` is not
used; the provider still owns request construction, authentication, response binding and corrections.
No endpoint, Worker adapter or service credentials are supplied by this example.

Identifiers cannot be shared with another provider or native composition. Register before sessions
open; existing sessions keep their own provider/configuration. Local restoration and retained
portrait inspection do not start analysis or buy another service check. An absent prepared report
or portrait remains unavailable; another image is not substituted. Regula findings do not establish
supplier qualification, document authenticity, holder identity or an assurance level by themselves.

## UI source and result ownership

| File | Responsibility |
| --- | --- |
| `App.tsx` | Composition root: safe-area provider and the configured app navigator. |
| `AppNavigator.tsx` | Native tabs and stacks, flow routing, and sensor-session lifetime from tab focus. |
| `AppDelegate.swift` | Host-owned native resource and custody configuration. |
| `IdentityCaptureFlow.tsx`, `CaptureFlowController.ts` | MRZ → review → NFC → passport result → optional paired TrueDepth selfie/comparison |
| `DriverLicenseFlow.tsx`, `DocumentFlowController.ts` | Front/back capture, encrypted document recovery and image review |
| `DocumentCheckPanel.tsx` | Explicit document-check consent, actual returned findings, local reply restore, requested corrections and reconciliation |
| `SSNFlow.tsx`, `PhoneFlow.tsx` and their controllers | Independent service journeys, native session ownership and interruption handling |
| `SensorScreen.tsx` and `SensorBoard*.tsx` | The Sensors tab's board and detail pages, and the Settings tab's sensor settings, sharing one sensor session with Fusion while any of these three tabs is in front |
| `useIdentityWorkspace.ts` | Owns the current holder’s retained sessions, saved-result restoration, handoff and erasure. Receives stable navigation callbacks; imports no view or navigator. |
| `IdentityHome.tsx`, `IdentityResults.tsx`, `IdentitySettings.tsx`, `IdentityRecovery.tsx` | Identity screen content and recovery presentation. Session ownership stays in the workspace hook. |
| `ui/Page.tsx` | One container for every screen and recovery sheet: branding, heading, Back/Cancel, safe areas, scrolling and keyboard insets. Camera mode fills the viewport below the same header. |
| `ui/useControllerState.ts`, `ui/ControllerCustody.tsx` | React external-store subscriptions acquire controllers after commit, invalidate stale publications on removal, and drain release before a successor acquires a native session. The custody barrier survives holder changes. |
| `ui/Action.tsx`, `ui/styles.ts`, `ui/List.tsx`, `ui/NativeSheet.tsx` | Shared buttons, content styles, inset grouped rows and system modal presentation. Features do not import another feature for UI primitives. |
| `ui/tokens.jsonc`, `locales/en.jsonc`, `generate-ui-resources.py` | Design tokens (iOS system colors, Dynamic Type styles, spacing, radii) and every UI string, compiled into `ui/tokens.generated.ts` and `locales/strings.generated.ts`; screens read text through `t()` in `locales/i18n.ts`. Edit the JSONC and rerun the generator; `--check` fails when the modules are stale |
| `brand/`, `ui/Wordmark.tsx` | The Kenshiki SDK app icon, generated native launch screen and its background, installed by `create-host.py`, and the wordmark in every page's shared header |

The brand lives in the tint and wordmark tokens in `ui/tokens.jsonc`, `brand` in `locales/en.jsonc`, and the icon and background in `brand/`. `generate-ui-resources.py` generates and checks the native launch-screen label from the same `brand.wordmark` used by the shared page header. To change the brand, edit these sources and regenerate the host.

Results and sensor detail pages are pushed screens. Page’s Back button uses the native navigation stack; the native edge swipe remains available.
Each capture or check is a full-screen modal whose shared Page Cancel leaves it the way the
check's own exit does. Journey recovery prompts are UIKit page sheets; destructive choices
are iOS action sheets. Apple's permission, NFC and message composer interfaces remain
system-owned. Active work cancels and drains on backgrounding; the user
explicitly resumes. No remote check is purchased by opening saved results.

A failed native release keeps the custody barrier rejected and presents one native notice to
close and reopen the app. Acquisition and erasure recovery must respect that barrier. Sensor
collection belongs to the visible Sensors or Settings page; an identity modal or developer-check
page ends that ownership. Controllers publish immutable snapshots, and views subscribe through
`useControllerState` instead of mirroring controller state in effects.

`IdentityCaptureFlow.onComplete(result)` transfers the live session to its recipient. The recipient
must call `result.session.release()` when it no longer needs decrypted native images. Merely unmounting
a completed flow does not release transferred ownership; canceling an unfinished flow does. Keep the
session while rendering `IdentityCaptureImage`, which references native image handles and digests.
Do not copy image bytes or PII into JavaScript persistence, analytics or logs.

The default AppDelegate configures separate encrypted stores in private app support directories, each
with dedicated Keychain names, and the hub opens the current holder's saved results at launch. Every
store is scoped to one local holder: its files are under `IdentityHolders/<holder UUID>/` (`Results`,
`Documents`, and on the simulator fixtures `ArtifactSSN` and `ArtifactPhone`), and its Keychain service
is `<app bundle ID>.identity.<holder UUID>.<store>`. The synthetic SSN enrollment/context ID and phone workflow ID are derived from the
holder, so the same holder reopens the same workflow. The AppDelegate creates the holder UUID once and
keeps it in `UserDefaults`; if the stored value cannot be read it configures no store and the hub says
so, rather than creating another holder. On the simulator only, `--reference-holder=<UUID>` selects the
holder for a launch. **This is a single-holder test host with no sign-in. Do not use its unchanged configuration in a multiuser or
shared-device SSA app.** Authenticate and select a stable local holder scope in native code before
configuring custody or mounting the identity UI. Use the
[scoped native configuration guidance](../../ReactNative/identity-capture/README.md#configure-in-native-code-before-mounting-react).
On a holder switch, cancel and drain active operations, release every old session, clear personal JavaScript
state and only then mount the next holder's configuration. Do not change credentials underneath a live
session. There is no single erase call for a holder: the
[logout and erasure sequence](../../ReactNative/identity-capture/README.md#logout-holder-switch-and-erasure)
erases each store in turn, and release alone preserves the encrypted records. A custody folder name or
workflow UUID is not authentication.

Passport/face completion is saved before publication. A save failure offers a local retry without repeating NFC or comparison. Startup opens a
single saved passport automatically; multiple workflows lead to a picker. A saved face result is attached
only to its matching passport portrait. Restored selfies are reviewable history, not fresh liveness evidence.

`release()` clears session memory; **it does not erase configured durable records**. Restart begins another
workflow and preserves existing saved results. Erase-all passport/face and erase-all document actions
require confirmation and remove their respective encrypted records/images and custody key. They are
separate domains; clearing a passport does not erase SSN, phone or document custody. Erasure failures
must remain visible and retryable. Without `configuration.results`, passport/face are session-only.
SSN and phone have their own explicit native recovery/erasure operations; use their supplied controllers.

The document check panel shows returned provider checks and submitted fields instead of a generic
success banner. It opens retained replies locally, requests a response only through an explicit action,
and allows only corrections named by that reply. SSN results show all five observations separately from the aggregate, including unavailable checks
and an adverse death-file match. They do not turn issuance alone into agreement. Phone results separate receipt evidence from the
subscriber comparison; reopening uncertainty does not silently start a new comparison. A receipt whose
carrier comparison is contradicted, or whose subscriber comparison is not satisfied, stops the journey
and offers a retry; it is never presented as a completed check.

## Troubleshooting

| Symptom | Check or next action |
| --- | --- |
| `cannot load such file -- xcodeproj` | Run the Ruby preflight above; install the gem for the same Ruby used by the script. |
| `pod` is missing or `pod install` fails | Check CocoaPods on PATH, selected Xcode, network access and the actual CocoaPods error. Do not alternate Ruby environments mid-install. |
| Missing runtime framework / native module | Use the built 0.6.0 tarball, finish `pod install`, open the workspace and rebuild the native app. Reloading JavaScript cannot add native code. |
| JavaScript bundle unavailable | Finish the bundle build phase; for bundled Debug set `IDENTITY_HOST_EMBEDDED_JAVASCRIPT=1`. Live Metro needs the Debug-only setup above. Inspect `ios/.xcode.env` and `.xcode.env.local` for a stale Node path. |
| Hardware recovery sheet on simulator | Expected. Use the physical-device path for real capture; do not remove the hardware gate. |
| Passport trust unavailable or face models unavailable | Check supplied resource formats and their URLs in AppDelegate. Never replace missing trust/model inputs with an accepted result. |
| SSN/phone/document service unavailable | Register the native adapter and matching provider ID/configuration. SDK installation alone supplies no live service credentials. |
| Saved results cannot be opened | Retry local recovery; preserve stable directory and Keychain names. Do not interpret an integrity/key failure as an empty store or automatically erase it. |
| NFC signing/entitlement error | Confirm the app identifier, team, NFC capability, provisioning profile and generated entitlements agree. |

## What testing establishes

Each check has a tier: **mock** runs JavaScript against mocked native sessions, **simulator** runs
the native code on an iOS simulator, and **device** runs on a physical iPhone.

- TypeScript (`npx tsc --noEmit`) checks source types. It runs no code.
- Jest (mock tier) tests UI and controller behaviour against mocked SDK sessions. It cannot prove
  native capture, encryption or a live provider.
- `ArtifactNativeTests` (simulator tier) executes the installed framework's public registration and
  refusal paths in a separate native unit host; it does not execute JavaScript or vendor analysis.
- The Xcode UI tests (simulator tier) exercise the installed binary through React Native and real
  simulator Keychain storage, including failure recovery.
- The developer checks (simulator tier, Debug builds only) use separate test custody and do not
  erase normal records.

Simulator-only launch fixtures are deliberately limited: `--ssn-artifact-fixture` answers only the
synthetic `000-00-1234`, which it reports as not issued (area 000 is never issued), and refuses every
other number before dispatch; `--phone-artifact-fixture` checks unavailable text messaging;
`--document-check-artifact-fixture` registers a provider that refuses dispatch and tests missing-front
rejection. None proves successful live document/provider checks or hardware capture. Synthetic document
response, correction and durable-recovery coverage is in the SDK's native runtime tests (simulator tier),
which are not part of this package.

For physical acceptance, capture and reopen documents; inspect document-check details with the qualified
provider; scan/review/read a passport; exercise pull-away, cancel and background recovery; compare a real
selfie; relaunch and inspect saved results; then erase and confirm they no longer reopen. Check unsupported
TrueDepth hardware fails closed. Record artifact hashes and device/OS with non-PII observations. VoiceOver,
large text, translations and actual SSA React Native integration require separate product acceptance.
Device acceptance must be established separately for the exact artifact. Use `SHA256SUMS`, the
embedded manifests and the release's executed test receipts; the
[SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md) explains the remaining dependencies.

## Decisions for the SSA app

The reference app leaves these to the SSA app. They are product decisions, not SDK features, and
the reference app does not build them:

- **Authentication before reopening saved results.** On launch the hub opens the local holder's
  saved passport and face results, and the SSN, phone and document screens open their saved checks,
  with no authentication step (`App.tsx`). Authenticate the holder before mounting the identity UI or
  opening any saved result.
- **Showing the holder's name on the hub.** The Passport card shows the given names and surname read
  from the chip (`App.tsx`). Decide whether a name may appear before authentication, and on a shared
  device.
- **The Privacy Act notice at SSN entry.** The reference SSN screen shows none (`SSNFlow.tsx`). The
  SSA app supplies the notice and places it before the number is entered.
- **Localization.** Every string is US English, in `locales/en.jsonc`, with ICU placeholders and
  plurals; dates use that catalog's en-US format in the device time zone. The app picks the catalog
  for the device language and falls back to English, the only catalog. Translations, and the
  permission strings `configure-host.rb` writes into `Info.plist`, are the SSA app's to supply.
- **The holder model.** The AppDelegate keeps one local holder UUID from first launch and scopes every
  store and Keychain name to it. There is no sign-in, holder picker or holder-switch screen. The SSA
  app resolves the local holder from its own authorization. On logout or a holder switch it releases
  every session and clears personal state before the next holder's configuration is mounted, and
  runs each capability's erase when the holder's records must be deleted, following the
  [logout and holder-switch sequence](../../ReactNative/identity-capture/README.md#logout-holder-switch-and-erasure).

## App Store Connect distribution

The reference delivery includes [Fastlane release instructions](fastlane/README.md) and the build,
signing and export checks. The generated app receives a self-contained `fastlane/` directory.
Use your own bundle identifier, Apple Developer team, App Store profile and App Store Connect
account. The editable app and the SDK binary keep separate source-revision records.

## Acceptance test plan

Follow [How to test the React Native SDK](../../docs/react-native-testing.md) for the source gates, installed-package tests, opt-in physical-device smoke tests and provider acceptance cases. `DeviceAcceptanceTests.swift` is copied into the generated UI-test target; it does not run device cases without explicit test-scheme opt-in.

### First-run permissions

The generated iOS host enables `firstRunPermissions`. Before mounting the main app, the introduction
reads permission status through the existing SDK sensor session. Three screens introduce Always
Location, Motion & Fitness, and Bluetooth, with one permission request per screen. They use the
shared Page and Action components and do not start collection. While Using is not shown
as an Always grant. Reduced accuracy has a link to Settings, and returning from Settings refreshes
the OS readings. Camera access stays with the capture flow.

Completing or skipping the final step releases the setup session before the main sensor session opens. A local UserDefaults
string records completion of the introduction; authorization is always read from iOS. Users can
continue without a grant and adjust access later in Settings.
