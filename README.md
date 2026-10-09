# React Native iOS reference app — 0.6.0

Start here to run an independent app against the delivered SDK. You need both
`kenshiki-identity-capture-0.6.0.tgz` and `kenshiki-identity-capture-0.6.0-reference-ui.zip` from
the same build; the [SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md) gives their
SHA-256. The generator installs the binary tarball; it does not require an SDK source checkout.
This is editable reference UI for the adopting team, not a finished SSA enrollment app. What it
leaves to the SSA app is listed under [Decisions for the SSA app](#decisions-for-the-ssa-app).

The baseline is **bare React Native 0.87.1, React 19.2.3, New Architecture, iOS 18+**. Android,
Expo Go and other React Native versions are not validated by this example. The generated CLI
project may contain Android files; this SDK delivery and these instructions are iOS only.

## 1. Prepare a Mac

Install the full Xcode application, select it with `xcode-select`, finish its first-launch setup,
and install an iPhone simulator runtime in Xcode Settings. Install Python 3, Node 22.11+ with npm,
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
all earlier or later versions work. The checks run on this build, with their tiers, are in the
[SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md#checks-behind-this-package).

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
before continuing. It does not build, launch or publish an app. If generation fails after creating the
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
npx tsc --noEmit
npx jest --runInBand
open ios/IdentitySDKHost.xcworkspace
```

In Xcode select the `IdentitySDKHost` scheme and an **iPhone simulator**. In Edit Scheme → Run,
set Build Configuration to **Release**, then Run. Release bundles JavaScript and needs no Metro
server. For Debug instead, run `npm start` from the host root in a second terminal before Run.
Open the `.xcworkspace`, not the `.xcodeproj`.

The Identity screen should offer Driver's license, Passport, Face match, Social Security number
and Phone cards. No provider or personal data is required to open it. The simulator host has no
trust anchors or face models, so the Passport card is disabled and says passport chip checking is
not set up; Face match is disabled without both models, and otherwise until a passport portrait
exists. A card for saved results stays available to open them. Simulator camera/NFC/TrueDepth and text messaging are unavailable:
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
The script copies them into `ios/CaptureResources`; AppDelegate resolves their bundle URLs and
passes them to the SDK explicitly. A trust result is only as appropriate as the supplied anchors.

Open the new workspace, give the app a unique test bundle identifier, select your Apple development
team and enable NFC Tag Reading for that app/provisioning profile. Set signing for the UI-test target
as well if testing on a device. Enable Developer Mode on the paired iPhone if Xcode requires it.
The script supplies camera/NFC usage descriptions, passport AID `A0000002471001` and TAG entitlement;
your team remains responsible for provisioning and product-appropriate permission copy.
Use a TrueDepth-equipped iPhone for selfie liveness. RGB-only hardware must fail closed. No
presentation-attack, false-match or false-non-match figures exist for this liveness check or the
face comparison.

Native service adapters are separate from hardware capture:

| Capability | What the adopting native team supplies |
| --- | --- |
| Document check | `DocumentCheckProvider`, registration via `IDCaptureRegisterDocumentCheckProvider`, and `configuration.document.check` |
| SSN issuance | `SSNIssuanceProvider`, `IDCaptureRegisterSSNIssuanceProvider`, stable workflow/context and dedicated custody configuration |
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

## UI source and result ownership

| File | Responsibility |
| --- | --- |
| `App.tsx`, `AppDelegate.swift` | Identity hub, startup recovery, host-owned resource/custody configuration |
| `IdentityCaptureFlow.tsx`, `CaptureFlowController.ts` | MRZ → review → NFC → passport result → optional paired TrueDepth selfie/comparison |
| `DriverLicenseFlow.tsx`, `DocumentFlowController.ts` | Front/back capture, encrypted document recovery and image review |
| `DocumentCheckPanel.tsx` | Explicit document-check consent, actual returned findings, local reply restore, requested corrections and reconciliation |
| `SSNFlow.tsx`, `PhoneFlow.tsx` and their controllers | Independent service journeys, native session ownership and interruption handling |
| `IdentitySheetHost.tsx` | Screen-level bottom-sheet host; wrap panels above scroll/navigation content |

All app recovery/confirmation prompts use bottom sheets. Apple's permission, NFC and message
composer interfaces remain system-owned. Active work cancels and drains on backgrounding; the user
explicitly resumes. No remote check is purchased by opening saved results.

`IdentityCaptureFlow.onComplete(result)` transfers the live session to its recipient. The recipient
must call `result.session.release()` when it no longer needs decrypted native images. Merely unmounting
a completed flow does not release transferred ownership; canceling an unfinished flow does. Keep the
session while rendering `IdentityCaptureImage`, which references native image handles and digests.
Do not copy image bytes or PII into JavaScript persistence, analytics or logs.

The default AppDelegate configures separate encrypted stores in private app support directories, each
with dedicated Keychain names, and the hub opens the current holder's saved results at launch. Every
store is scoped to one local holder: its files are under `IdentityHolders/<holder UUID>/` (`Results`,
`Documents`, and on the simulator fixtures `ArtifactSSN` and `ArtifactPhone`), and its Keychain service
is `<app bundle ID>.identity.<holder UUID>.<store>`. The SSN and phone workflow IDs are derived from the
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
and allows only corrections named by that reply. SSN results describe issuance, not ownership, and
render provider details or explicit missing values. Phone results separate receipt evidence from the
subscriber comparison; reopening uncertainty does not silently start a new comparison. A receipt whose
carrier comparison is contradicted, or whose subscriber comparison is not satisfied, stops the journey
and offers a retry; it is never presented as a completed check.

## Troubleshooting

| Symptom | Check or next action |
| --- | --- |
| `cannot load such file -- xcodeproj` | Run the Ruby preflight above; install the gem for the same Ruby used by the script. |
| `pod` is missing or `pod install` fails | Check CocoaPods on PATH, selected Xcode, network access and the actual CocoaPods error. Do not alternate Ruby environments mid-install. |
| Missing runtime framework / native module | Use the built 0.6.0 tarball, finish `pod install`, open the workspace and rebuild the native app. Reloading JavaScript cannot add native code. |
| JavaScript bundle unavailable | Release must finish the bundle build phase; Debug needs Metro from this host root. Inspect `ios/.xcode.env` and `.xcode.env.local` for a stale Node path. |
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
No device-tier result is recorded for this build. The current hashes, the checks behind this build and
the open dependencies are in the [SSA distribution note](../../Distribution/SSA-DISTRIBUTION-NOTE.md).

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
- **Localization.** Every string is US English and written in the source files; dates use the en-US
  format in the device time zone. Strings are not externalized.
- **The holder model.** The AppDelegate keeps one local holder UUID from first launch and scopes every
  store and Keychain name to it. There is no sign-in, holder picker or holder-switch screen. The SSA
  app resolves the local holder from its own authorization. On logout or a holder switch it releases
  every session and clears personal state before the next holder's configuration is mounted, and
  runs each capability's erase when the holder's records must be deleted, following the
  [logout and holder-switch sequence](../../ReactNative/identity-capture/README.md#logout-holder-switch-and-erasure).
