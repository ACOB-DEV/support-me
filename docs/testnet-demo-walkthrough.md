# Testnet demo walkthrough

A scripted, step-by-step run through SupportMe on the Stellar testnet, using
two personas: a **creator** and a **supporter**. Each step names the exact UI
action or CLI command, and an expected result to check before moving on —
either a UI state or a `stellar.expert` transaction link pattern. Read
alongside the [quickstart](../README.md#installation) and
[`docs/testnet-troubleshooting.md`](testnet-troubleshooting.md) if a step
doesn't match what you see.

This walks through the v2 (recurring-donations) contracts. The addresses
below are the v2 contracts from the [README's contract
table](../README.md#smart-contracts-stellar-testnet); confirm they still
match before you start, since the SDF resets the testnet from time to time.

- `donation` (v2): `CAO2UABEB4A3EYFTWCMOSTFAUZ5FBSFRESQGWQHOLASZ3RHDCQHQG2LP`
- `creator-registry` (v2): `CB6PH7KYI3UHAUNYIJVCV7CT6BOBROLSR4LSZB3WSGFOYOW6JFAF5NDU`
- Network: Stellar Testnet, RPC `https://soroban-testnet.stellar.org`

## Contents

- [Before you start](#before-you-start)
- [Step 1: Create and fund the two personas](#step-1-create-and-fund-the-two-personas)
- [Step 2: Creator onboarding](#step-2-creator-onboarding)
- [Step 3: A one-off XLM tip](#step-3-a-one-off-xlm-tip)
- [Step 4: A USDC tip](#step-4-a-usdc-tip)
- [Step 5: Setting a funding goal](#step-5-setting-a-funding-goal)
- [Step 6: Subscribing with a short custom interval](#step-6-subscribing-with-a-short-custom-interval)
- [Step 7: Watching the executor charge](#step-7-watching-the-executor-charge)
- [Step 8: Cancelling the subscription](#step-8-cancelling-the-subscription)
- [Step 9: Downloading a receipt](#step-9-downloading-a-receipt)
- [Video script / shot list](#video-script--shot-list)

## Before you start

You need the full stack running locally against the v2 contracts (the live
demo at `support-mee.vercel.app` still runs on v1, so it will not show the
recurring-donation flow in steps 6-8 — see the README's "What's New (v5)"
note). From a fresh checkout:

```bash
# Backend
cd backend
npm install
cp .env.example .env
# DATABASE_URL must point at a running Postgres; see CONTRIBUTING.md.
npx prisma migrate dev
npm run dev   # http://localhost:4000

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env.local   # already defaults to the v2 contract IDs
npm run dev   # https://localhost:3000
```

You also need the [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
(`stellar`) installed, for the two steps the web UI does not cover
(Friendbot funding and `register_creator`).

### The executor: required env for the recurring-donation steps

Steps 6-7 (subscribe, then watch a charge fire) need the backend's
subscription executor running. It is the one place the backend signs and
submits a transaction on its own behalf (see
[`backend/src/services/subscriptionExecutor.ts`](../backend/src/services/subscriptionExecutor.ts)),
using an "executor" keypair the contract admin has authorized via
`set_executor`.

In `backend/.env`:

```bash
# The executor's own keypair (pays fees only, never custodies donor funds).
# Generate with: stellar keys generate demo-executor
# Fund with Friendbot (see Step 1), then get the secret key with:
#   stellar keys show demo-executor --show-secret
EXECUTOR_SECRET_KEY=S...

# How often the executor polls for due subscriptions. The documented
# default is 60000 (60s) in backend/.env.example; for this demo, set it much
# shorter so a reviewer does not have to wait a full production-length poll
# interval to see a charge fire.
SUBSCRIPTION_EXECUTOR_POLL_INTERVAL_MS=5000
```

Restart `npm run dev` in `backend/` after changing either value. On startup
you should see a log line:

```
SubscriptionExecutor started { executorAddress: 'G...', pollIntervalMs: 5000, expectedIntervalMs: 15000 }
```

If you instead see `SubscriptionExecutor cannot start: missing
NEXT_PUBLIC_DONATION_CONTRACT_ID or EXECUTOR_SECRET_KEY`, one of those two
variables is unset.

## Step 1: Create and fund the two personas

Generate two local keypairs, one per persona, and fund both with Friendbot
(testnet-only faucet).

```bash
stellar keys generate demo-creator
stellar keys generate demo-supporter

stellar keys fund demo-creator --network testnet
stellar keys fund demo-supporter --network testnet

stellar keys address demo-creator      # note this down as CREATOR_ADDRESS
stellar keys address demo-supporter    # note this down as SUPPORTER_ADDRESS
```

**Expected result:** `stellar keys fund` prints a success message for each
account. You can confirm independently by opening
`https://stellar.expert/explorer/testnet/account/<ADDRESS>` for each
address: it should show a non-zero XLM balance (Friendbot funds new testnet
accounts with 10,000 XLM).

If you'd rather fund a wallet you'll connect in the browser (Freighter,
xBull, etc. - see Step 2), use that wallet's own "Fund with Friendbot" button
on testnet, or open `https://friendbot.stellar.org/?addr=<YOUR_G_ADDRESS>`
directly.

To tip in USDC later (Step 4), the supporter also needs a USDC trustline to
the SDF test issuer:

```bash
stellar tx new change-trust \
  --source-account demo-supporter --network testnet \
  --line "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA"
```

**Expected result:** the trustline transaction confirms with no error. If
you're using a wallet extension instead, add the asset from its "Add asset" /
"Manage assets" screen with the same code and issuer.

## Step 2: Creator onboarding

The creator persona needs a wallet extension (Freighter, xBull, Albedo, or
Rabet) set to **Testnet**, imported with the `demo-creator` secret key from
Step 1 (`stellar keys show demo-creator --show-secret`).

1. Open `https://localhost:3000` and click **Connect Wallet**. Approve the
   connection and sign the challenge message your wallet prompts for
   (SEP-0043/SEP-0053 sign-in - no password).
   **Expected result:** you land on `/auth/username` (a fresh wallet has no
   profile yet).
2. Enter a username (letters, numbers, `_`/`-`, 3+ characters) and a display
   name, then submit.
   **Expected result:** you're redirected to `/app`, the creator hub. This
   call (`POST /api/creators/:username/create`) only creates the app-level
   profile record; it does not itself touch the chain.
3. Register the same username on-chain, directly against the `donation`
   contract (the frontend does not drive this call itself today - this
   mirrors the `register_creator` example transaction in the README's
   contract table):

   ```bash
   stellar contract invoke --id CAO2UABEB4A3EYFTWCMOSTFAUZ5FBSFRESQGWQHOLASZ3RHDCQHQG2LP \
     --source-account demo-creator --network testnet -- \
     register_creator --creator demo-creator --username "<your-username>"
   ```

   **Expected result:** the CLI prints the returned `CreatorProfile` (with
   `donation_count: 0`, `total_donations: 0`). Find the transaction at
   `https://stellar.expert/explorer/testnet/tx/<HASH>` (the CLI prints the
   hash); its operation should show a `register_creator` cross-contract call
   into the `creator-registry` contract.

## Step 3: A one-off XLM tip

Switch to the supporter persona's browser session (or an incognito window)
with a wallet imported from `demo-supporter`.

1. Visit the creator's public profile at
   `https://localhost:3000/<creator-username>`.
   **Expected result:** the page shows the creator's display name, avatar,
   and a tip form with preset/custom amount buttons.
2. Connect the supporter's wallet if prompted, choose or type an amount (e.g.
   `5`), leave the asset selector on **XLM**, optionally add a short message,
   and click **Send Donation**.
   **Expected result:** a status sequence appears (building -> awaiting
   signature -> submitting -> pending -> success). Approve the signature
   request in your wallet when it appears.
3. Once it succeeds, note the transaction hash shown in the success state (or
   read it from your wallet's activity/history).
   **Expected result:** `https://stellar.expert/explorer/testnet/tx/<HASH>`
   shows a successful transaction invoking the `donation` contract's
   `donate` function, with an inner cross-contract call into
   `creator-registry`'s `record_donation`. The creator's dashboard
   (`/dashboard`, once signed in as the creator) should show the new
   donation in its recent-supporters feed within a few seconds (it streams
   over SSE from the backend's Soroban event listener).

## Step 4: A USDC tip

Same page, same persona, different asset - this exercises the generic
`token: Address` parameter on `donate` rather than hardcoding XLM.

1. On the same creator profile page, switch the asset selector to **USDC**.
   (It only appears if `NEXT_PUBLIC_USDC_ISSUER` is set in `.env.local` -
   it's set by default in `.env.example`.)
   **Expected result:** the amount field and any USD-equivalent hint update
   to reflect USDC.
2. Enter an amount (e.g. `10`) and click **Send Donation**, approving the
   signature in your wallet.
   **Expected result:** same status sequence as Step 3. If it fails
   immediately with a trustline-related error, you skipped the
   `change-trust` step for USDC in Step 1.
3. Check the resulting transaction.
   **Expected result:**
   `https://stellar.expert/explorer/testnet/tx/<HASH>` shows a `donate` call
   whose `token` argument is the USDC Stellar Asset Contract's address (not
   the native asset), and a balance change on the USDC trustline rather than
   on XLM.

## Step 5: Setting a funding goal

Still signed in as the creator:

1. Go to `/settings` and find the goals section.
2. Fill in a title (e.g. "New microphone"), a target amount (e.g. `50`), pick
   a currency (XLM or USDC - whichever you tipped in above, so the next
   donation moves it), and save.
   **Expected result:** the new goal appears in the list, with
   `currentAmount` counted from matching past donations (so if your XLM tip
   from Step 3 was 5 against a 50 XLM goal, it should already show partial
   progress).
3. Return to the creator's public profile.
   **Expected result:** a goal progress bar renders, showing current/target
   and the percentage funded.

## Step 6: Subscribing with a short custom interval

As the supporter, on the creator's profile page:

1. Toggle to the recurring/subscription option in the tip form, and choose
   the **custom** interval option.
   **Expected result:** a "days between charges" field appears. The UI
   constrains this field to whole days (minimum 1) - it is not meant for
   sub-day demo intervals, so for a demo that charges within minutes instead
   of a day, use the CLI call below instead of this field.
2. To actually get a short interval for the demo (e.g. 60 seconds between
   charges, so Step 7 doesn't require an overnight wait), call `subscribe`
   directly:

   ```bash
   stellar contract invoke --id CAO2UABEB4A3EYFTWCMOSTFAUZ5FBSFRESQGWQHOLASZ3RHDCQHQG2LP \
     --source-account demo-supporter --network testnet -- \
     subscribe --supporter demo-supporter --creator demo-creator \
     --token <NATIVE_XLM_SAC_ADDRESS> --amount 5000000 --interval_secs 60
   ```

   (`--amount` is in stroops; `5000000` = 0.5 XLM. Get the native asset's SAC
   address with `stellar contract id asset --asset native --network
   testnet`.)
   **Expected result:** the CLI prints the returned `subscription_id` (a
   `u64`, starting from `0` for the first subscription ever created on this
   contract deployment). The transaction at
   `https://stellar.expert/explorer/testnet/tx/<HASH>` shows a `subscribe`
   call; its `SubscribedEvent` topic data includes `interval_secs: 60` and a
   `next_charge_at` timestamp 60 seconds out.
3. Grant the donation contract an allowance on the native SAC, so
   `charge_subscription` can later draw funds via `transfer_from` without a
   fresh signature each time:

   ```bash
   stellar contract invoke --id <NATIVE_XLM_SAC_ADDRESS> \
     --source-account demo-supporter --network testnet -- \
     approve --from demo-supporter --spender CAO2UABEB4A3EYFTWCMOSTFAUZ5FBSFRESQGWQHOLASZ3RHDCQHQG2LP \
     --amount 30000000 --expiration_ledger <CURRENT_LEDGER_PLUS_A_FEW_THOUSAND>
   ```

   Get the current ledger with `stellar network info --network testnet` (or
   just re-use the ledger shown in the previous step's transaction) and add
   a few thousand so it does not expire mid-demo. `30000000` stroops (3 XLM)
   covers six 0.5 XLM charges.
   **Expected result:** `https://stellar.expert/explorer/testnet/tx/<HASH>`
   shows a successful `approve` call on the native SAC contract.

## Step 7: Watching the executor charge

With the backend running and `SUBSCRIPTION_EXECUTOR_POLL_INTERVAL_MS` set
short (Step "Before you start"), the executor's own background loop finds
and charges due subscriptions without any further action from you.

1. Watch the backend's log output.
   **Expected result:** within one poll interval after `next_charge_at`
   passes (60 seconds after Step 6, then every 5 seconds the executor polls
   after that), you see:
   ```
   SubscriptionExecutor tick started { dueCount: 1 }
   SubscriptionExecutor charge succeeded { subscriptionId: ..., transactionHash: '...', nextChargeAt: '...' }
   ```
2. Check that transaction.
   **Expected result:**
   `https://stellar.expert/explorer/testnet/tx/<transactionHash from the log>`
   shows a `charge_subscription` call signed by the executor's address (not
   the supporter's), with an inner `transfer_from` moving funds from
   supporter to creator, and a cross-contract `record_donation` call to
   `creator-registry`.
3. Check the creator's dashboard or profile goal bar.
   **Expected result:** the recurring charge counts toward any matching
   active goal from Step 5, same as a one-off donation; the dashboard's
   recent-activity feed shows a new entry with message "recurring".
4. Optionally wait for a second charge (another ~60 seconds) to see
   `next_charge_at` advance again and confirm the executor is not
   double-charging within one period.

## Step 8: Cancelling the subscription

As the supporter:

```bash
stellar contract invoke --id CAO2UABEB4A3EYFTWCMOSTFAUZ5FBSFRESQGWQHOLASZ3RHDCQHQG2LP \
  --source-account demo-supporter --network testnet -- \
  cancel_subscription --supporter demo-supporter --subscription_id <ID from Step 6>
```

Or from the web UI: sign in as the supporter, go to `/app/subscriptions`,
find the subscription, and click **Cancel**.

**Expected result:** the CLI (or UI) call succeeds. The transaction at
`https://stellar.expert/explorer/testnet/tx/<HASH>` shows a
`cancel_subscription` call that also zeroes the native SAC allowance in the
same transaction (check the `approve` operation inside it sets amount to
`0`). Wait one more poll interval and confirm in the backend logs that the
executor's next tick does **not** charge this subscription again
(`dueCount` should no longer include it, since `get_subscription` now shows
`active: false`).

## Step 9: Downloading a receipt

The receipt page at `/receipt/[txHash]` is a standalone page driven entirely
by its URL (transaction hash plus query parameters) - it is not yet linked to
from the donate flow, so build the URL yourself from the hash and details
of a donation from any step above (Step 3 works well since it's a plain
one-off donation):

```
https://localhost:3000/receipt/<HASH>?amount=5&asset=XLM&creatorName=<Display%20Name>&creatorUsername=<username>&message=<url-encoded%20message>&timestamp=<ISO-8601%20timestamp>
```

**Expected result:** a formatted receipt renders with the amount, asset,
creator name, message, and a link to
`https://stellar.expert/explorer/testnet/tx/<HASH>` ("View on Stellar
Explorer"). Click **Print / Save PDF** - this calls the browser's native
print dialog (`window.print()`); choose "Save as PDF" as the destination to
get a downloadable file. The print stylesheet hides the on-screen navigation
and buttons so the saved PDF shows only the receipt itself.

## Video script / shot list

A shot list for a 3-5 minute Loom re-record of this walkthrough, so repeat
recordings stay consistent. Record at 1080p+ with the browser zoomed to
fit comfortably; keep a terminal window ready for the CLI-only steps
(register_creator, subscribe, approve, cancel_subscription).

| # | Shot (screen to show) | Narration | Duration |
| - | --- | --- | --- |
| 1 | Title card / README | "SupportMe is a creator tipping and donation platform on Stellar. This is a full walkthrough on testnet, from creator signup to a recurring donation." | 10s |
| 2 | Terminal: `stellar keys fund` for both personas, then a stellar.expert account page | "Two testnet personas, both funded via Friendbot: a creator and a supporter." | 15s |
| 3 | Browser: connect wallet, sign challenge, `/auth/username` form | "The creator connects a wallet, signs a challenge message - no password - and picks a username." | 20s |
| 4 | Terminal: `register_creator` CLI call, then its stellar.expert tx page | "Registering the username on-chain, in the donation contract's registry." | 15s |
| 5 | Browser: creator's public profile, supporter tipping 5 XLM, status sequence, success state | "A supporter sends a one-off 5 XLM tip. Watch the status move from building to signed to confirmed." | 25s |
| 6 | stellar.expert tx page for the XLM donate call | "The transaction: a `donate` call that cross-calls the registry to update the creator's lifetime stats." | 15s |
| 7 | Browser: asset selector switched to USDC, tipping 10 USDC | "The same flow works with USDC - same `donate` function, different token address." | 20s |
| 8 | Browser: `/settings` goal form, then the profile page's goal bar | "The creator sets a 50 XLM funding goal; it fills in from matching past donations immediately." | 20s |
| 9 | Terminal: `subscribe` CLI call with `interval_secs 60`, then `approve` call | "A supporter starts a recurring 0.5 XLM donation every 60 seconds for this demo, then approves an allowance so the contract can draw funds automatically." | 25s |
| 10 | Backend terminal log: `SubscriptionExecutor tick started` / `charge succeeded` | "The backend's executor polls every few seconds and fires the charge itself once it's due - no action from the supporter." | 20s |
| 11 | stellar.expert tx page for the `charge_subscription` call | "The charge: signed by the executor, not the supporter, drawing on the pre-approved allowance." | 15s |
| 12 | Terminal: `cancel_subscription` call, then the next executor tick log showing it's no longer due | "Cancelling revokes the remaining allowance in the same transaction, and the executor stops picking it up." | 20s |
| 13 | Browser: `/receipt/[txHash]` page, clicking Print / Save PDF | "Any donation can be turned into a printable receipt, with a direct link to its testnet transaction." | 15s |
| 14 | Closing card: README link, GitHub repo | "That's the full loop: onboarding, one-off and recurring donations, goals, and receipts, all verifiable on stellar.expert." | 10s |

Total: ~3 minutes 45 seconds, before any editing pauses.
