# Kenshiki Identity reference app

[![CI](https://github.com/Kenshiki-Labs/kenshiki-identity-reference-app/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Kenshiki-Labs/kenshiki-identity-reference-app/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kenshiki/identity-capture?label=%40kenshiki%2Fidentity-capture)](https://www.npmjs.com/package/@kenshiki/identity-capture)

The production React Native iOS app for the Kenshiki Identity SDK. It runs a relying party's identity
journey end to end — driver's license or state ID, passport chip, face match, phone, SSN and location — on
the SDK's released npm package
[`@kenshiki/identity-capture`](https://www.npmjs.com/package/@kenshiki/identity-capture), and shows what
each check returned. The SDK is public and the app is open to any team: install the package from npm,
build your app from this one, and ship it under your own name. Reviewers, including AI tools, read it to
evaluate how the SDK is integrated and what each check proves.

## The IAL2 identity-proofing journey

The Identity tab runs a complete identity-proofing journey built to NIST SP 800-63A IAL2. The person
chooses an ID, prepares, and then completes five steps in order:

| Step | What the person does | What is checked | Source |
| --- | --- | --- | --- |
| 1. License | Photographs the front and back of a driver's license or state ID, reviews it, and confirms the check | The license against its issuing record | [`IdentityLicenseFlow.tsx`](src/onboarding/IdentityLicenseFlow.tsx), [`DocumentCheckPanel.tsx`](src/identity/DocumentCheckPanel.tsx) |
| 2. Phone | Sends a prepared text from the number being verified | Possession of that phone, and the carrier comparison | [`PhoneFlow.tsx`](src/identity/PhoneFlow.tsx) |
| 3. Face | Takes a live TrueDepth selfie | The selfie against the license portrait, on the phone | [`IdentityLicenseFace.tsx`](src/onboarding/IdentityLicenseFace.tsx) |
| 4. SSN | Enters and confirms the number in a secure native entry sheet | Issuance, death file, name, address and phone, each reported separately | [`SSNFlow.tsx`](src/identity/SSNFlow.tsx) |
| 5. Location and surroundings | Allows location and motion | The phone's location, and its air pressure against nearby weather | [`IdentityEnvironmentCheck.tsx`](src/onboarding/IdentityEnvironmentCheck.tsx) |

A combined review then shows four cards: the ID with its face match, the phone, the SSN, and location
and Air check. Each opens a read-only report
([`IdentityVerificationResult.tsx`](src/onboarding/IdentityVerificationResult.tsx),
[`IdentityVerificationDetail.tsx`](src/onboarding/IdentityVerificationDetail.tsx)). The journey runs in that
order and refuses shortcuts: a license record mismatch cannot advance to the phone step, and a stale SSN
binding cannot reach the final check. [`IdentityDLOnboarding.test.tsx`](src/onboarding/IdentityDLOnboarding.test.tsx)
drives the real app through the whole sequence. Sensitive entries — license corrections, phone details
and the SSN — stay in native sheets; React receives only the status of each step.

The journey is engineered to the IAL2 requirements; conformance is assessed independently, and this
repository does not claim a certification.

**Requirements:** iOS 18 or later · Xcode 26 · Node 22.13+ or 24.3+ · CocoaPods · React Native 0.87.1,
React 19.2.3, New Architecture. Camera, passport NFC and TrueDepth capture need a physical iPhone.

## Production

- **Built on the released SDK.** `@kenshiki/identity-capture` comes from the npm registry under semantic
  versioning. `package-lock.json` pins the exact release by its integrity value, and patch releases arrive
  with `npm update`.
- **A complete app.** Native tabs and stacks, encrypted holder-scoped stores configured in native code
  before React mounts, recovery screens when the camera, NFC, depth sensing, text messaging or a service is
  unavailable, and every string in one catalog.
- **Personal data stays native.** License barcode fields, the document provider's findings and
  corrections, phone evidence and SSN digits are entered and shown in native sheets owned by the SDK.
  React receives only each step's status, so personal data never enters the JavaScript runtime, its
  bundle, its logs or its debugging tools.
- **Gated on every change.** CI runs the type check, the Jest suite, the generated-resource and SBOM checks,
  and a Release iOS build on every pull request and every push to `dev` and `main`.
- **Shippable.** The [fastlane lane](fastlane/README.md) builds, signs and uploads to App Store Connect under
  your Apple account.
- **Accounted for.** [`sbom/`](sbom) holds a CycloneDX software bill of materials for each release: every npm
  package, and the native frameworks inside the SDK.

## Run it

```sh
git clone https://github.com/Kenshiki-Labs/kenshiki-identity-reference-app
cd kenshiki-identity-reference-app
npm ci
cd ios && pod install && cd ..
npx react-native run-ios --mode Release
```

`npm ci` installs the SDK from the npm registry at the version and integrity value in `package-lock.json`.
Release builds bundle the JavaScript, so no Metro server is needed. You can also open
`ios/IdentitySDKHost.xcworkspace` in Xcode, choose the `IdentitySDKHost` scheme and run.

The app opens on four tabs: **Fusion**, **Sensors**, **Identity** and **Settings**. The Identity tab lists
Driver's license, Passport, Face match, Social Security number and Phone. On a simulator, camera, NFC,
TrueDepth and text messaging are unavailable, so those checks show their recovery screens; that is
expected.

## Check it

```sh
npm run typecheck            # TypeScript
npm test                     # Jest: screens and controllers against mocked SDK sessions
npm run check:ui-resources   # generated tokens, strings and launch screen match their sources
```

The UI tests run the installed SDK through React Native on a simulator:

```sh
xcodebuild test -workspace ios/IdentitySDKHost.xcworkspace -scheme IdentitySDKHost \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

Debug builds embed the JavaScript bundle, so the UI tests need no Metro server. Simulator-only launch
arguments register fixtures that refuse to dispatch: `--ssn-artifact-fixture` answers only the synthetic
number 000-00-1234, `--phone-artifact-fixture` exercises unavailable text messaging, and
`--document-check-artifact-fixture` exercises a missing document front. None of them stands in for a
successful live check. `DeviceAcceptanceTests.swift` runs on a physical iPhone only when the test scheme
sets `SDK_DEVICE_ACCEPTANCE=1`.

## What each check returns

| Check | What the app receives from the SDK and shows | Where |
| --- | --- | --- |
| Driver's license or state ID | Front and back photos and the result of the check against the issuing record. The barcode details, the provider's findings and any corrections it asks for open in a native sheet, so they never reach JavaScript | [`DriverLicenseFlow.tsx`](src/identity/DriverLicenseFlow.tsx), [`DocumentCheckPanel.tsx`](src/identity/DocumentCheckPanel.tsx), [`DocumentCustodyPresentation.ts`](src/identity/DocumentCustodyPresentation.ts) |
| Passport | The machine-readable zone, then the chip read with a result for each protocol: country signing chain, document signature, data-group hashes, Active Authentication and Chip Authentication | [`IdentityCaptureFlow.tsx`](src/identity/IdentityCaptureFlow.tsx), [`CaptureFlowController.ts`](src/identity/CaptureFlowController.ts) |
| Face match | A TrueDepth selfie compared on the phone with the license portrait (in the journey) or the passport chip's portrait; without depth there is no result | [`IdentityLicenseFace.tsx`](src/onboarding/IdentityLicenseFace.tsx), [`FaceResultDetails.tsx`](src/identity/FaceResultDetails.tsx) |
| Phone | Possession through a text message sent from the phone, and the carrier comparison: agreed, single source, contradicted, unavailable or not compared | [`PhoneFlow.tsx`](src/identity/PhoneFlow.tsx), [`PhoneResultDetails.tsx`](src/identity/PhoneResultDetails.tsx), [`SubscriberResultDetails.tsx`](src/identity/SubscriberResultDetails.tsx) |
| SSN | Five separate results: issuance record, death-file record, name, address and phone association | [`SSNFlow.tsx`](src/identity/SSNFlow.tsx), [`SSNResultDetails.tsx`](src/identity/SSNResultDetails.tsx) |
| Location (Air check) | The phone's barometric pressure compared with local weather at its position | [`AirCheckScreen.tsx`](src/fusion/AirCheckScreen.tsx) |
| Continuity | Whether the phone's signed readings continue its history: first pass, held or broke | [`ContinuityScreen.tsx`](src/fusion/ContinuityScreen.tsx) |

The verdicts come from the SDK; the app presents them. The SDK's guide states what each one establishes
and its limits.

## Where to read

| Path | What it holds |
| --- | --- |
| [`src/app/`](src/app) | Composition root ([`App.tsx`](src/app/App.tsx)), native tabs and stacks ([`AppNavigator.tsx`](src/app/AppNavigator.tsx)), the holder's sessions, saved results and erasure ([`useIdentityWorkspace.ts`](src/app/useIdentityWorkspace.ts)), and the simulator-only SDK checks under Settings |
| [`src/identity/`](src/identity) | One flow per check. License: [`DriverLicenseFlow.tsx`](src/identity/DriverLicenseFlow.tsx), [`DocumentFlowController.ts`](src/identity/DocumentFlowController.ts), [`DocumentCheckPanel.tsx`](src/identity/DocumentCheckPanel.tsx). Passport and face: [`IdentityCaptureFlow.tsx`](src/identity/IdentityCaptureFlow.tsx), [`CaptureFlowController.ts`](src/identity/CaptureFlowController.ts), [`FaceResultDetails.tsx`](src/identity/FaceResultDetails.tsx). Phone: [`PhoneFlow.tsx`](src/identity/PhoneFlow.tsx), [`PhoneFlowController.ts`](src/identity/PhoneFlowController.ts). SSN: [`SSNFlow.tsx`](src/identity/SSNFlow.tsx), [`SSNFlowController.ts`](src/identity/SSNFlowController.ts). Each `*ResultDetails.tsx` shows what the check returned |
| [`src/fusion/`](src/fusion) | Air check (barometer against local weather), continuity, and the explanation pages |
| [`src/sensors/`](src/sensors) | The sensor board, its detail pages and its settings |
| [`src/ui/`](src/ui) | The shared page, list, action and sheet components, controller custody, and the design tokens ([`tokens.jsonc`](src/ui/tokens.jsonc)) |
| [`src/locales/`](src/locales) | Every UI string ([`en.jsonc`](src/locales/en.jsonc)) and the `t()` runtime |
| [`src/testing/`](src/testing) | Jest support and synthetic fixtures. Each `*.test.ts(x)` sits beside the file it tests |
| [`ios/`](ios) | The native project. [`AppDelegate.swift`](ios/IdentitySDKHost/AppDelegate.swift) configures the SDK's encrypted stores and the local holder before React mounts. UI tests: [`ArtifactIntegrationTests.swift`](ios/ArtifactIntegrationTests.swift), [`DeviceAcceptanceTests.swift`](ios/DeviceAcceptanceTests.swift) |
| [`assets/`](assets) | Sensor page text and configuration, and the U.S. passport trust bundle with its provenance ([`passport-us/`](assets/passport-us)) |
| [`scripts/`](scripts) | [`generate-ui-resources.py`](scripts/generate-ui-resources.py) compiles the tokens, strings and launch screen |
| [`fastlane/`](fastlane) | Build, sign and upload to App Store Connect under your own Apple accounts ([guide](fastlane/README.md)) |

AI reviewers: start with [AGENTS.md](AGENTS.md).

## Native services and licensed resources

The SDK calls no service on its own behalf except those its guide lists under *What leaves the phone*.
Document record checks, SSN checks and phone checks each need a native provider that the app registers
in `AppDelegate.swift`; this app registers none outside the simulator fixtures, so those checks report
that they are not set up. Face models, passport trust anchors and the document reader's licence and
database are supplied by the adopting team and are not in this repository.

## Decisions for the adopting app

The reference app leaves these to the adopting app:

- **Authentication before reopening saved results.** On launch the app opens the local holder's saved
  results with no authentication step. Authenticate the holder before mounting the identity UI.
- **The holder's name on the home screen.** The passport row shows the name read from the chip. Decide
  whether a name may appear before authentication, and on a shared device.
- **A notice at SSN entry.** The SSN screen shows none. The adopting app supplies the notice its own rules
  require and places it before the number is entered.
- **Localization.** Every string is US English in `src/locales/en.jsonc`. Translations, and the permission
  strings in `Info.plist`, are the adopting app's to supply.
- **The holder model.** `AppDelegate.swift` keeps one local holder from first launch and scopes every
  store to it. There is no sign-in or holder switch. On logout or a holder switch, release every session
  and clear personal state before the next holder's configuration is mounted.

## Roadmap

Planned work, without dates. None of it is in this release.

- **Passport in the journey.** The passport route joins the IAL2 journey alongside the license.
- **First-run flow.** A guided first run, launched from this app.
- **Android.** The Android SDK is in beta.
- **Live service adapters.** The native adapters for document, SSN and phone checks, published in this
  repository.

## Documentation, API and support

- **SDK integration guide:** the [`@kenshiki/identity-capture` README](https://www.npmjs.com/package/@kenshiki/identity-capture),
  also installed at `node_modules/@kenshiki/identity-capture/README.md`
- **API:** the package's TypeScript types (`node_modules/@kenshiki/identity-capture/src/index.tsx`) and
  error codes (`ERRORS.md` in the package)
- **Versions:** the SDK follows semantic versioning; `^0.8.0` takes its patch releases with `npm update`
- **Support:** hello@kenshikilabs.com; security reports through [SECURITY.md](SECURITY.md)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **License:** free to use, modify and ship as part of your app; see [LICENSE](LICENSE)
