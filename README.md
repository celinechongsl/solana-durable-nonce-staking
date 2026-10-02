# Stake SOL with a durable nonce

Stake SOL through [Figment's staking API](https://docs.figment.io/reference/solana-stake) when your signing process takes longer: an HSM, an MPC quorum, or a custody approval flow.

## The problem

Every Solana transaction references a recent blockhash. The network rejects it after about 150 blocks, roughly 60 to 90 seconds, which prevents replays. A hot wallet signs well inside that window. An HSM or custody approval flow often does not.

## The fix

A [durable nonce](https://solana.com/docs/core/transactions/durable-nonces) stores a value that a transaction uses instead of a fast-expiring blockhash. The value only changes when the nonce is advanced, so the transaction stays valid until it is executed or the nonce is advanced. When you pass `nonce_account` to Figment's `/solana/stake` endpoint, the returned unsigned transaction includes the required `AdvanceNonceAccount` instruction.

## What the script does

1. Finds this wallet's nonce account in `nonce-accounts.json`, or creates one onchain and saves it there (first run only).
2. Requests an unsigned stake transaction from Figment with `nonce_account`.
3. Verifies before signing: `AdvanceNonceAccount` is the first instruction and the nonce matches the value onchain.
4. Signs and broadcasts through Figment.
5. Prints the explorer link to the transaction.

## Requirements

- Node 22+
- A Figment API key
- SOL wallet with at least 1.2 SOL: 1.1 SOL minimum stake, plus transaction fees, rent reserve for the stake and nonce accounts. 

## Run

```bash
npm install
cp .env.example .env      # add API_KEY and PRIVATE_KEY
npm run stake
```

## Nonce accounts

The script keeps its nonce accounts in `nonce-accounts.json`, one per wallet:

```json
{
  "<wallet address>": "<nonce account address>"
}
```

- **First run with a wallet:** creates a nonce account (about 0.0015 SOL rent) and saves it.
- **Later runs:** reuses the saved account, after checking it still exists onchain and the wallet is its authority.
- **Switching `PRIVATE_KEY`:** each wallet gets its own entry.
- **Deleting the file:** the script creates new accounts. The old ones stay onchain, unused.

## Taking this to production
- **Signing:** replace `sign()` with a call to your HSM or custodian.
