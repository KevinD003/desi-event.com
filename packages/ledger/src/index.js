/**
 * Double-entry composition.
 *
 * What each commerce event posts, and the proof it balances — with no database,
 * no clock and no ids, so the rules can be tested exhaustively and the
 * persistence can be tested separately. The persistence lives in
 * `apps/api/src/lib/ledger.js`; the database enforces the same balance rule again
 * at posting time, which is not redundancy: this layer gives a caller a useful
 * error, and the trigger is true for every writer including a `psql` prompt.
 *
 * @module @desi-event/ledger
 */

export { ACCOUNTS, ALL_ACCOUNTS, CREDIT, DEBIT, NORMAL_BALANCE, isAccount } from './accounts.js'
export {
  BATCH_KINDS,
  MAX_ENTRY_MINOR,
  composeBatch,
  correctionBatch,
  disputeOpenedBatch,
  disputeResolvedBatch,
  entry,
  orderPaidBatch,
  payoutBatch,
  refundBatch,
  refundSettledBatch,
  transferBatch,
  transferReversalBatch,
} from './batches.js'
export { LEDGER_ERROR_CODES, LedgerError } from './errors.js'
