# Stake SOL with a durable nonce

Stake SOL through [Figment's staking API](https://docs.figment.io/reference/solana-stake) when your signing process takes longer than a hot wallet: an HSM, an MPC quorum, or a custody approval flow.

## The problem

Every Solana transaction references a recent blockhash. The network rejects it after about 150 blocks, roughly 60 to 90 seconds, which prevents replays. A hot wallet signs well inside that window. An HSM or custody approval flow often does not, so the transaction expires before it can be broadcast.

## The fix

A [durable nonce](https://solana.com/docs/core/transactions/durable-nonces) account stores a value that a transaction uses instead of a fast-expiring blockhash. The value only changes when the nonce is advanced, so the transaction stays valid until it is executed or the nonce is advanced.

When you pass `nonce_account` to Figment's `/solana/stake` endpoint, the returned unsigned transaction is built on the nonce and includes the required `AdvanceNonceAccount` instruction.

## What the script does

1. Finds this wallet's nonce account in `nonce-accounts.json`, or creates one onchain and saves it there.
2. Requests an unsigned stake transaction from Figment with `nonce_account`.
3. Verifies before signing: `AdvanceNonceAccount` is the first instruction, and the nonce matches the value onchain.
4. Signs and broadcasts through Figment.
5. Prints the explorer link to the transaction.

## Requirements

- Node 22 or later
- A Figment API key
- A wallet with at least 1.2 SOL: 1.1 SOL minimum stake, plus rent for the stake and nonce accounts, plus fees

## Run

```bash
npm install
cp .env.example .env      # add API_KEY and PRIVATE_KEY
npm run stake
```

## Nonce accounts

On the first run, the script creates a nonce account onchain and saves its address to `nonce-accounts.json`, creating the file automatically. Later runs reuse it.

```json
{
  "<wallet address>": "<nonce account address>"
}
```

- **First run with a wallet:** creates a nonce account (about 0.0015 SOL rent) and saves it.
- **Later runs:** reuse the saved account, after checking it still exists onchain and the wallet is its authority.
- **Switching wallets:** each wallet gets its own entry.
- **Deleting the file:** the script creates new accounts. The old ones remain onchain, unused.

The file holds public addresses only. It is listed in `.gitignore` because it is specific to your setup.

This script keeps one nonce account per wallet because it sends one transaction at a time. Solana allows one wallet to control many nonce accounts, which parallel signing requires (see below).


## Taking this to production
A production integration needs the following changes.

**Signing**
- Replace `sign()` with a call to your HSM, MPC provider or custodian. Send the serialized transaction or the `signing_payload` from Figment's response, depending on what your signer accepts.

**Parallel signing**
- A nonce account holds one value at a time, and only one transaction can use it. If several transactions built on the same nonce are signed together, the first to land advances the nonce and the rest are rejected.
- To sign in parallel, keep a pool of nonce accounts, one per transaction in flight, and mark each as busy until its transaction lands or is cancelled.

**Cancelling a signed transaction**
- A durable nonce transaction does not expire. If a signed transaction is never broadcast, it stays valid, and anyone holding a copy could broadcast it later.
- To cancel it, have the nonce authority submit a transaction that only advances the nonce. Any transaction signed with the old value is then rejected.

**Failure handling**
- Never retry with a previously built payload. Request a new unsigned transaction from Figment.
- Wait for confirmation before updating internal balances. Durable nonce transactions have no blockhash expiry, so poll the signature status rather than relying on block height.

**Configuration**
- Set `NETWORK` to `mainnet` and `VALIDATOR_VOTE_ACCOUNT` to your chosen mainnet validator.

**Operations**
- Treat the nonce authority as an operational key: whoever holds it can advance the nonce and invalidate every pending transaction built on it.
- Unused nonce accounts hold rent. Close them with `SystemProgram.nonceWithdraw` to recover the SOL.
