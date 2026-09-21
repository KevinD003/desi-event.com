/**
 * The retention vocabulary, and the two functions that reach an operator.
 *
 * This module is shared on purpose: the worker rehearses against these
 * durations and the API describes them to whoever reads the result. A copy in
 * each would be two copies that drift, and the first symptom of that drift
 * would be an operator shown a number under the wrong label.
 *
 * Both exported functions are **fallback functions** — they answer for inputs
 * the module does not know — which is exactly the kind of code that is written
 * once, never exercised, and wrong when it finally runs. There was no test file
 * here at all until a coverage threshold noticed.
 *
 * @module @desi-event/schemas/retention.test
 */

import { describe, expect, it } from 'vitest'

import {
  RETENTION_APPROVAL,
  RETENTION_CLASS_PROPOSALS,
  RETENTION_FAILURE_CODES,
  RETENTION_FAILURE_CODE_VALUES,
  RETENTION_NOT_EVALUATED,
  retentionApprovalFor,
  retentionFailureDescription,
} from './retention.js'

describe('the proposal itself', () => {
  it('labels every class as proposed rather than settled', () => {
    // The label travels with the number rather than living in a heading, so a
    // figure copied into a ticket carries its status with it.
    for (const proposal of RETENTION_CLASS_PROPOSALS) {
      expect(proposal.approval).toBe(RETENTION_APPROVAL)
      expect(proposal.approval).toMatch(/REQUIRES LEGAL\/PRIVACY REVIEW/u)
    }

    for (const entry of RETENTION_NOT_EVALUATED) {
      expect(entry.approval).toBe(RETENTION_APPROVAL)
    }
  })

  it('gives every class a reason to exist, in words', () => {
    for (const proposal of RETENTION_CLASS_PROPOSALS) {
      expect(proposal.basis.length).toBeGreaterThan(10)
      expect(proposal.proposedDays).toBeGreaterThan(0)
    }
  })

  it('is frozen, so a reader cannot edit the policy it was handed', () => {
    expect(Object.isFrozen(RETENTION_CLASS_PROPOSALS)).toBe(true)
    expect(Object.isFrozen(RETENTION_CLASS_PROPOSALS[0])).toBe(true)
  })
})

describe('retentionApprovalFor', () => {
  it('answers for a class that is evaluated', () => {
    expect(retentionApprovalFor('login_attempt')).toBe(RETENTION_APPROVAL)
  })

  it('answers for a class that is listed but not evaluated', () => {
    expect(retentionApprovalFor('export_artifact')).toBe(RETENTION_APPROVAL)
  })

  it('answers for a class it has never heard of, rather than returning nothing', () => {
    // The safe direction, and the reason this function exists at all. An
    // unrecognised class name is still an unapproved duration; answering "no
    // status" for one would be the single way a number could reach a reader
    // unlabelled.
    expect(retentionApprovalFor('invented_later')).toBe(RETENTION_APPROVAL)
    expect(retentionApprovalFor('')).toBe(RETENTION_APPROVAL)
    expect(retentionApprovalFor(undefined)).toBe(RETENTION_APPROVAL)
  })
})

describe('retentionFailureDescription', () => {
  it('words every code in the vocabulary', () => {
    for (const code of RETENTION_FAILURE_CODE_VALUES) {
      const wording = retentionFailureDescription(code)

      expect(wording, code).toBeTypeOf('string')
      expect(wording.length, code).toBeGreaterThan(20)
      // A sentence, not a restatement of the constant.
      expect(wording, code).not.toBe(code)
    }
  })

  it('says nothing for a row that did not fail', () => {
    // Null rather than a reassuring sentence: a description beside a row that
    // succeeded would be a description somebody reads as a warning.
    expect(retentionFailureDescription(null)).toBeNull()
    expect(retentionFailureDescription(undefined)).toBeNull()
    expect(retentionFailureDescription('')).toBeNull()
  })

  it('shows an unknown code as it was stored, so it can be quoted', () => {
    // Never invents a sentence for a code it does not know. A row written by a
    // newer worker against an older reader still has to be readable, and the
    // code is what somebody puts in a ticket.
    expect(retentionFailureDescription('MADE_UP_LATER')).toBe('MADE_UP_LATER')
  })

  it('distinguishes a failed count from a failed qualification', () => {
    // The two are different facts. A candidate count that failed examined
    // nothing; a hold count that failed means the candidates *were* counted and
    // the figure could not be qualified — and an examined count nobody could
    // qualify reads as "this many would be deleted" when nothing checked what
    // was forbidden.
    const candidates = retentionFailureDescription(RETENTION_FAILURE_CODES.CANDIDATE_COUNT_FAILED)
    const holds = retentionFailureDescription(RETENTION_FAILURE_CODES.HOLD_COUNT_FAILED)

    expect(candidates).not.toBe(holds)
    expect(candidates).toMatch(/nothing was examined/iu)
    expect(holds).toMatch(/counted/iu)
  })

  it('never suggests a failed rehearsal changed something', () => {
    // The one thing none of these sentences may imply. A rehearsal that failed
    // still changed nothing, and an operator reading a failure must not be left
    // wondering whether it got halfway.
    for (const code of RETENTION_FAILURE_CODE_VALUES) {
      expect(retentionFailureDescription(code), code).not.toMatch(/deleted|removed|erased/iu)
    }
  })
})
