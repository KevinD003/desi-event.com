/**
 * The template list, and the agreement it exists to enforce.
 *
 * `templates.js` says three places must agree about template names: the domain
 * code that writes a row, the worker that renders one, and the operator surface
 * that groups them. Nothing asserted that until this file, which is how the
 * suppressibility list came to disagree with every call site that writes one.
 *
 * @module @desi-event/notifications/templates.test
 */

import { describe, expect, it } from 'vitest'

import {
  OUTBOX_TEMPLATES,
  UNSUPPRESSIBLE_TEMPLATES,
  isOutboxTemplate,
  isSuppressible,
} from './templates.js'

describe('the template list', () => {
  it('is frozen, so an importer cannot add a name at runtime', () => {
    expect(Object.isFrozen(OUTBOX_TEMPLATES)).toBe(true)
    expect(Object.isFrozen(UNSUPPRESSIBLE_TEMPLATES)).toBe(true)
  })

  it('has no duplicate', () => {
    expect(new Set(OUTBOX_TEMPLATES).size).toBe(OUTBOX_TEMPLATES.length)
  })

  it('names every template in the dotted, lower-case form an operator sorts by', () => {
    for (const template of OUTBOX_TEMPLATES) {
      expect(template, `${template} is not a dotted lower-case name`).toMatch(
        /^[a-z]+(\.[a-z]+)+$/u,
      )
    }
  })
})

describe('isOutboxTemplate', () => {
  it.each([...OUTBOX_TEMPLATES])('recognises %s', (template) => {
    expect(isOutboxTemplate(template)).toBe(true)
  })

  it.each([
    // A near miss rather than nonsense: the mistakes that actually happen are a
    // family that does not exist, a plural, and a name in the wrong case.
    ['event.cancelled ', 'a trailing space'],
    ['EVENT.CANCELLED', 'the wrong case'],
    ['events.cancelled', 'a pluralised family'],
    ['event.cancel', 'a truncated verb'],
    ['', 'nothing at all'],
  ])('refuses %s (%s)', (template) => {
    expect(isOutboxTemplate(template)).toBe(false)
  })
})

describe('suppressibility', () => {
  it('never marks a name unsuppressible that the outbox does not know', () => {
    // The failure this catches: a template renamed in one list and not the
    // other. The stale entry then suppresses nothing, silently, and the renamed
    // one becomes suppressible without anybody deciding that.
    for (const template of UNSUPPRESSIBLE_TEMPLATES) {
      expect(OUTBOX_TEMPLATES, `${template} is unsuppressible but not a template`).toContain(
        template,
      )
    }
  })

  it('is the exact complement of the unsuppressible list', () => {
    for (const template of OUTBOX_TEMPLATES) {
      expect(isSuppressible(template)).toBe(!UNSUPPRESSIBLE_TEMPLATES.has(template))
    }
  })

  it("refuses to let a preference drop a message about somebody's money or ticket", () => {
    // Spelled out rather than derived, because this list is a decision and a
    // test that recomputed it from the source would assert nothing.
    for (const template of [
      'event.cancelled',
      'event.postponed',
      'event.changed',
      'ticket.issued',
      'ticket.transfer.invited',
      'ticket.revoked',
      'refund.settled',
      'security.alert',
    ]) {
      expect(isSuppressible(template), `${template} can be suppressed`).toBe(false)
    }
  })

  it('leaves the courtesy confirmation suppressible', () => {
    // The sender's "your transfer went through". The recipient already has
    // `ticket.issued` for the ticket itself, so this one is genuinely optional —
    // and a list where everything is unsuppressible is a list that decides
    // nothing.
    expect(isSuppressible('ticket.transfer.completed')).toBe(true)
  })

  it('treats a name it does not know as suppressible rather than special', () => {
    // A template nobody declared must not acquire the strongest delivery
    // guarantee by being unrecognised.
    expect(isSuppressible('marketing.blast')).toBe(true)
  })
})
