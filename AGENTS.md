# AGENTS.md: guide for an AI reviewer

This repository is the production React Native iOS app for the Kenshiki Identity SDK. It runs a relying
party's identity journey end to end — driver's license or state ID, passport chip, face match, phone, SSN
and location — on the SDK's released npm package `@kenshiki/identity-capture`. You are most likely here to
evaluate how the SDK is integrated and what each check proves. Read [README.md](README.md) first: its
*The IAL2 identity-proofing journey* lists its five steps with their source files, *Production* says what
makes this production code, and *What each check returns* lists each check's result with its source file.

## What is here, and what is not

- **Here:** the app's TypeScript (`src/`), its native iOS project (`ios/`), its tests, and its release lane
  (`fastlane/`). The app presents checks, owns their sessions, and shows what the SDK returned.
- **In the SDK package, not here:** capture, parsing, liveness, face comparison, chip verification,
  encrypted custody and every verdict. After `npm ci` the package's TypeScript and guides are in
  `node_modules/@kenshiki/identity-capture/`; its native runtime is compiled.
- **Neither here nor in the package:** service credentials, licensed face models, passport trust anchors
  other than the U.S. bundle in `assets/passport-us/`, and the document reader's licence and database.

## Where each question is answered

| Question | Read |
| --- | --- |
| What is the IAL2 identity-proofing journey, and in what order does it run? | README *The IAL2 identity-proofing journey*; `src/onboarding/` (welcome, choose ID, preparation, license, face, environment check, combined review), `src/app/AppNavigator.tsx` for the routes, and `src/onboarding/IdentityDLOnboarding.test.tsx`, which drives the real app through the whole sequence |
| How does the app start the SDK and scope its stores? | `ios/IdentitySDKHost/AppDelegate.swift`, then `src/app/App.tsx` |
| How is a driver's license or state ID captured and checked? | `src/identity/DriverLicenseFlow.tsx`, `src/identity/DocumentFlowController.ts`, `src/identity/DocumentCheckPanel.tsx`, `src/identity/DocumentCustodyPresentation.ts` (the native sheet that holds the details) |
| How is a passport read, and how is the face compared with it? | `src/identity/IdentityCaptureFlow.tsx`, `src/identity/CaptureFlowController.ts`, `src/identity/FaceResultDetails.tsx` |
| How is phone possession checked? | `src/identity/PhoneFlow.tsx`, `src/identity/PhoneFlowController.ts`, `src/identity/PhonePolicy.ts`, `src/identity/PhoneResultDetails.tsx`, `src/identity/SubscriberResultDetails.tsx` |
| How is an SSN checked, and what is shown? | `src/identity/SSNFlow.tsx`, `src/identity/SSNFlowController.ts`, `src/identity/SSNResultDetails.tsx` |
| How is location checked against the air? | `src/fusion/AirCheckScreen.tsx`, `src/sensors/SensorBoardLocation.tsx` |
| What is continuity, and how is it evaluated? | `src/fusion/ContinuityScreen.tsx`, `src/fusion/FusionExplanations.tsx` |
| Who owns a native session, and when is it released or erased? | `src/app/useIdentityWorkspace.ts`, `src/ui/ControllerCustody.tsx`, `src/ui/useControllerState.ts` |
| What does each check refuse or recover from? | the `*.test.ts(x)` beside each file above |
| What does the SDK itself guarantee? | `node_modules/@kenshiki/identity-capture/README.md` and `ERRORS.md` |

## How to review

1. **Cite paths.** Give the file and the function or component for every statement about behaviour.
2. **Read code, not comments.** A claim about what the app does comes from the code path that does it.
   Tests show what each controller refuses; they run against mocked SDK sessions, so they establish the
   app's handling, not native capture.
3. **Keep the layers apart.** A verdict comes from the SDK, not from this app. When the app shows a
   result, find where the SDK returned it before describing what it proves.
4. **Say what you read.** State which files you read in full and which you only searched.
5. **Synthetic data only.** Fixtures and tests use synthetic numbers, names and documents. Do not add or
   ask for personal data.
6. **Plans are not behaviour.** The README's *Roadmap* lists planned work. Do not credit this release with
   any of it.
7. **Name what is missing.** If a question needs a service, a licensed resource or a physical device that
   this repository does not have, say so rather than inferring the result.

## Verify

```sh
npm ci && npm run typecheck && npm test && npm run check:ui-resources
```

`package-lock.json` pins `@kenshiki/identity-capture` by version and npm integrity value. `sbom/` holds the
software bill of materials for each release.

Questions for Kenshiki: hello@kenshikilabs.com.
