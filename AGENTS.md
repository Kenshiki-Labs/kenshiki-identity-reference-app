# AGENTS.md: guide for an AI reviewer

<!-- BEGIN kenshiki-universal v1 · synced from @kenshiki/config (Kenshiki-Labs/ci packages/config/agents.md) · edit it there, not here -->
## Kenshiki rules for every repository

These apply to every coding agent (Claude, Codex, Cursor, Copilot and others) and to the people
directing them. The repository's own rules follow this block. Where the two differ, the stricter one
applies. A repository section may add rules; it never grants an exception to these.

### Authorization

- Do not stage, commit, push, merge, deploy or publish unless the person directing you asked for
  that specific action. Approval for one action does not extend to the next.
- Irreversible operations need explicit confirmation first: `git checkout`/`restore`/`reset`/`clean`
  over changed files, `rm`, force-push, overwriting a file you have not read, dropping a database
  table. Being confident you understood is not permission.
- Never bypass hooks (`--no-verify`).
- Live calls that cost money or reach real people (SMS, carrier lookups, payment, email) need
  authorization for that task.

### Preserve other work

- Read `git status` before editing. Uncommitted changes you did not make belong to someone else:
  leave them alone, never stage them, never revert them.
- Other sessions and other developers work in these repositories at the same time. If a file changed
  on disk since you read it, read it again.

### Branches and worktrees

- Two long-lived branches: `dev`, where work is integrated and pull requests land, and `main`, what is
  released and deployed. No other branch lives longer than its task.
- Every task is one topic branch off `dev`, named `feat/`, `fix/`, `chore/` or `docs/` plus a short
  name. It reaches `dev` by a pull request with green checks, is merged (squash unless the repository's
  own procedure says otherwise), and is deleted on merge.
- `main` moves only by promotion of a `dev` commit whose checks are green: a fast-forward, or a merge
  commit where the repository's promotion procedure says so. Never commit or open a topic pull request
  into `main`, and never squash or rebase `dev` into `main`.
- Work in progress is committed to its topic branch and pushed. The only copy of work is never a stash,
  an unpushed branch or a temporary directory.
- Extra worktrees live at `~/Developer/<repo>.worktrees/<branch>`, never under `/tmp` or a scratch
  directory, and are created and removed with `npx @kenshiki/config work start|clean`. Never remove a
  worktree that holds uncommitted or unpushed work.
- Tags are for releases only, made by the repository's release process.

### Verify before you assert

- Read a file in full before you make a claim about it, edit it, review it or brief another agent on
  it. Search output locates files and proves absence; it is not evidence of what code does.
- Cite `file:line` for claims about code, or say "unverified".
- For any external system (a vendor API, an Apple framework, an RFC, ICAO, AAMVA) read the current
  contract before writing integration code or diagnosing a failure. What you remember is a hypothesis.
  If you cannot reach the document, say so.
- A passing test is not proof the behaviour is right; tests can encode the defect. Check behaviour
  against the contract, the wire payload or the server's enforcement.
- A briefing to another agent is an assertion: read the governing gate or contract before writing it,
  and tell the agent to read files in full, never to "spot-check".

### Gates

- Run the repository's check (`npm run check`, `make check` or what its section names) before
  proposing a commit.
- Executable declarations (guards, contract files, lockfiles, CI checks) outrank your reading of the
  code. If one blocks your change, fix the real cause or raise it. Never edit a declaration to match
  what you just did, never weaken or delete a gate, never suppress a finding to clear it.
- Shared tooling comes from Kenshiki-Labs/ci: CI through its reusable workflows, Biome, ESLint and
  TypeScript settings from `@kenshiki/config`. Do not add a local copy of something it provides.
- Dependencies are pinned exactly. Node is pinned in `.node-version`.

### Secrets and personal data

- Never print, log, commit or paste secrets, tokens, private keys or personal data (phone numbers,
  document images, identity records) into code, diffs, logs or chat.
- Credentials live in ignored local files or the platform's secret store (Worker secrets, GitHub
  secrets, the keychain). Real identity data and sample documents never go into a repository.

### Code

- Propagate errors by default. Catch only to recover or to add context before rethrowing; a catch that
  logs and continues, returns an empty value or rethrows unchanged is not allowed.
- Await, return or hand off every Promise to an owned lifecycle (`ctx.waitUntil`). `void promise` is
  not error handling.
- Fail closed on integrity and authorization checks.

### Scope

- An instruction that says _only_, _don't_ or _one_ narrows the work. A follow-up narrows the earlier
  instruction; it never widens it.
- If you think a case is an exception, ask before acting. Do not leave it out silently and do not
  announce it afterwards.
- Change one thing, show the result, wait. Add the new thing beside the old, move one call site, and
  delete the old one only after the new one is accepted.
- On visual work, produce the screenshot before the second change.
- "Stop" means stop now.

### Decisions and checkpoints

- A decision that is genuinely the owner's goes to them as a question, with your recommendation as the
  first option. Use the client's question tool when it has one; never bury the choice in prose.
- An engineering-correctness fork has one right answer. Work it out, state it and do it; do not offer
  a menu. Asking is never a substitute for working.
- Work expected to run past about 30 minutes or touch more than three files checkpoints at every unit
  that leaves the tree green: a three-line status (done, in progress, next), the gates on the touched
  files, and an offer to commit the work in progress. An offer, not a commit.

### Reporting

- Name the level of evidence: written, compiles, covered by a named test, verified by a named run,
  verified on a device. Do not say "verified" without a run in this session.
- Report only checks you actually ran, with the commit and whether the tree was clean. Separate what
  you measured from what you inferred.
- Report a defect as the file, the line, the cause and the fix. Do not add who wrote it.
- State a correction plainly, once, and carry on.
<!-- END kenshiki-universal -->



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
