require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bs58 = require('bs58');
const axios = require('axios');
const {
  Connection,
  Keypair,
  NonceAccount,
  NONCE_ACCOUNT_LENGTH, // SDK account size for rent, not a user setting
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

const API_HEADERS = { 'x-api-key': process.env.API_KEY };
const NETWORK = 'devnet'; // change to mainnet for production
const EXPLORER_BASE_URL = 'https://explorer.solana.com/tx/';
const FIGMENT_API_URL = 'https://api.figment.io/solana';
const STAKE_AMOUNT = 1.1;
const VALIDATOR_VOTE_ACCOUNT = 'DaRwg7fkGs6Dnbh2cwPwmcsottXCuLBafCAJuQKySZq7'; //change to mainnet validator address for production
const NONCE_FILE = path.join(__dirname, 'nonce-accounts.json'); // one saved nonce account per wallet

const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

function loadNonceAccounts() {
  if (!fs.existsSync(NONCE_FILE)) return {};
  const content = fs.readFileSync(NONCE_FILE, 'utf8').trim();
  return content ? JSON.parse(content) : {};
}

function saveNonceAccount(wallet, nonceAccount) {
  const saved = loadNonceAccounts();
  saved[wallet.publicKey.toString()] = nonceAccount.toString();
  fs.writeFileSync(NONCE_FILE, JSON.stringify(saved, null, 2));
}

async function nonceValue(account) {
  return NonceAccount.fromAccountData((await connection.getAccountInfo(account)).data).nonce;
}

async function getOrCreateNonceAccount(wallet) {
  // Reuse this wallet's saved nonce account if it still exists onchain and this wallet is its authority
  const saved = loadNonceAccounts()[wallet.publicKey.toString()];
  if (saved) {
    const existing = new PublicKey(saved);
    const info = await connection.getAccountInfo(existing);
    const authority = info && NonceAccount.fromAccountData(info.data).authorizedPubkey;
    if (authority && authority.equals(wallet.publicKey)) return existing;
    console.log('Saved nonce account no longer exists onchain. Creating a new one.');
  }

  const nonceAccount = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.createNonceAccount({
      fromPubkey: wallet.publicKey,
      noncePubkey: nonceAccount.publicKey,
      authorizedPubkey: wallet.publicKey,
      lamports: rent
    })),
    [wallet, nonceAccount]
  );
  saveNonceAccount(wallet, nonceAccount.publicKey);
  console.log(`Created nonce account ${nonceAccount.publicKey} for wallet ${wallet.publicKey}`);
  return nonceAccount.publicKey;
}

async function createStakeTransaction(wallet, validatorVoteAccount, nonceAccount) {
  const response = await axios.post(`${FIGMENT_API_URL}/stake`, {
    funding_account: wallet.publicKey.toString(),
    vote_account: validatorVoteAccount.toString(),
    amount_sol: STAKE_AMOUNT,
    network: NETWORK,
    nonce_account: nonceAccount.toString(),
    nonce_authority: wallet.publicKey.toString()
  }, { headers: API_HEADERS });
  return response.data.data;
}

async function verify(tx, nonceAccount) {
  const ix = tx.instructions[0];
  if (!ix.programId.equals(SystemProgram.programId) || ix.data.readUInt32LE(0) !== 4 || !ix.keys[0].pubkey.equals(nonceAccount)) {
    throw new Error('First instruction must advance our nonce account');
  }
  if (tx.recentBlockhash !== await nonceValue(nonceAccount)) {
    throw new Error('Transaction nonce does not match onchain');
  }
}

function sign(unsignedTx, wallet) {
  const transaction = Transaction.from(Buffer.from(unsignedTx, 'hex'));
  transaction.partialSign(wallet);
  return transaction;
}

async function broadcastStakeTransaction(signedTx) {
  const response = await axios.post(`${FIGMENT_API_URL}/broadcast`, {
    transaction_payload: signedTx.serialize().toString('hex'),
    network: NETWORK
  }, { headers: API_HEADERS });
  return response.data.transaction_hash;
}

async function main() {
  try {
    const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const validatorVoteAccount = new PublicKey(VALIDATOR_VOTE_ACCOUNT);
    const nonceAccount = await getOrCreateNonceAccount(wallet);

    const stakeTx = await createStakeTransaction(wallet, validatorVoteAccount, nonceAccount);
    const tx = Transaction.from(Buffer.from(stakeTx.unsigned_transaction_serialized, 'hex'));
    await verify(tx, nonceAccount);
    const signedTx = sign(stakeTx.unsigned_transaction_serialized, wallet);
    const txHash = await broadcastStakeTransaction(signedTx);

    console.log(`Staked ${STAKE_AMOUNT} SOL to ${VALIDATOR_VOTE_ACCOUNT} successfully!`);
    console.log('Stake account:', stakeTx.stake_account);
    console.log('View transaction on explorer:', `${EXPLORER_BASE_URL}${txHash}?cluster=${NETWORK}`);
    console.log('Nonce advanced to', await nonceValue(nonceAccount));
  } catch (error) {
    console.error('Error:', error.response?.data?.error || error.message);
  }
}

main();