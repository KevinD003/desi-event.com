'use client'

/**
 * The editor's two content steps: the line-up and running order, and the
 * information guests look for — questions, a public contact, links and sponsors.
 *
 * Both write through the editor's one `PATCH /v1/events/:id`, like the details
 * step: the fields are part of the event's form values, autosaved with the
 * rest, and checked by `contentProblems` before anything is sent. Everything
 * here is shown to the public, so every box says so where it matters.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-content-steps
 */

import { RepeatableList } from './repeatable-list.jsx'
import { FormField, Input, Textarea } from './ui.jsx'
import {
  CONTENT_LIMITS,
  SOCIAL_HOSTS,
  SOCIAL_NETWORK_LABELS,
  SOCIAL_NETWORKS,
  blankRow,
} from '../lib/event-content.js'

/**
 * @typedef {object} ContentStepProps
 * @property {object} values The editor's form values.
 * @property {Function} setField Change one field.
 * @property {boolean} editable Whether the fields accept input.
 * @property {Record<string, string>} [errors] Problems by field id, without the `event-` prefix.
 */

/**
 * A counter line: "120 of 600 characters".
 *
 * @param {string} value The box.
 * @param {number} max The limit.
 * @returns {string} The line.
 */
function counter(value, max) {
  return `${String(value ?? '').length.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} characters`
}

/**
 * FormField props for one box, with its error when there is one.
 *
 * @param {Record<string, string>} errors Problems by field id.
 * @param {string} field The field id, without the prefix.
 * @returns {object} `id`, and `error` when there is one.
 */
function fieldProps(errors, field) {
  return { id: `event-${field}`, ...(errors[field] ? { error: errors[field] } : {}) }
}

/**
 * The line-up and the running order.
 *
 * @param {ContentStepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
export function ProgrammeStep({ values, setField, editable, errors = {} }) {
  return (
    <section aria-labelledby="programme-heading" className="space-y-5">
      <h2 id="programme-heading" className="text-xl font-semibold text-ink">
        Line-up and running order
      </h2>
      <p className="text-sm text-ink-muted">
        Both appear on the public event page. Leave a list empty to show nothing.
      </p>

      <RepeatableList
        noun="performer"
        title="Line-up"
        description="In billing order. A role and a short bio are optional."
        idPrefix="event-performers"
        rows={values.performers}
        onChange={(rows) => setField('performers', rows)}
        blank={() => blankRow('performers')}
        max={CONTENT_LIMITS.performers}
        disabled={!editable}
        renderRow={(row, index, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Name" required {...fieldProps(errors, `performers-${index}-name`)}>
              <Input
                value={row.name}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.performerName}
                onChange={(change) => update({ name: change.target.value })}
              />
            </FormField>
            <FormField
              label="Role"
              description="For example: lead vocals, tabla."
              {...fieldProps(errors, `performers-${index}-role`)}
            >
              <Input
                value={row.role}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.performerRole}
                onChange={(change) => update({ role: change.target.value })}
              />
            </FormField>
            <FormField
              label="Short bio"
              className="sm:col-span-2"
              description={counter(row.bio, CONTENT_LIMITS.performerBio)}
              {...fieldProps(errors, `performers-${index}-bio`)}
            >
              <Textarea
                rows={3}
                value={row.bio}
                disabled={!editable}
                onChange={(change) => update({ bio: change.target.value })}
              />
            </FormField>
          </div>
        )}
      />

      <RepeatableList
        noun="slot"
        title="Running order"
        description={`Local time at the event (${values.timezone}). A run of several nights shows the same order each night.`}
        idPrefix="event-runningOrder"
        rows={values.runningOrder}
        onChange={(rows) => setField('runningOrder', rows)}
        blank={() => blankRow('runningOrder')}
        max={CONTENT_LIMITS.runningOrderItems}
        disabled={!editable}
        renderRow={(row, index, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
            <FormField label="Time" required {...fieldProps(errors, `runningOrder-${index}-time`)}>
              <Input
                type="time"
                value={row.time}
                disabled={!editable}
                onChange={(change) => update({ time: change.target.value })}
              />
            </FormField>
            <FormField
              label="What happens"
              required
              {...fieldProps(errors, `runningOrder-${index}-title`)}
            >
              <Input
                value={row.title}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.runningOrderTitle}
                onChange={(change) => update({ title: change.target.value })}
              />
            </FormField>
            <FormField
              label="Note"
              className="sm:col-span-2"
              description={counter(row.note, CONTENT_LIMITS.runningOrderNote)}
              {...fieldProps(errors, `runningOrder-${index}-note`)}
            >
              <Input
                value={row.note}
                disabled={!editable}
                onChange={(change) => update({ note: change.target.value })}
              />
            </FormField>
          </div>
        )}
      />
    </section>
  )
}

/**
 * Questions, a public contact, links and sponsors.
 *
 * @param {ContentStepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
export function GuestInfoStep({ values, setField, editable, errors = {} }) {
  /**
   * Change one social link.
   *
   * @param {string} network The network.
   * @param {string} href The address.
   * @returns {void}
   */
  const setLink = (network, href) =>
    setField('socialLinks', { ...values.socialLinks, [network]: href })

  return (
    <section aria-labelledby="guest-info-heading" className="space-y-5">
      <h2 id="guest-info-heading" className="text-xl font-semibold text-ink">
        Guest information
      </h2>
      <p className="text-sm text-ink-muted">
        Everything on this step is shown on the public event page.
      </p>

      <RepeatableList
        noun="question"
        title="Questions people ask"
        description="The ones you are asked every year: parking, food, children, what to wear."
        idPrefix="event-faq"
        rows={values.faq}
        onChange={(rows) => setField('faq', rows)}
        blank={() => blankRow('faq')}
        max={CONTENT_LIMITS.faqItems}
        disabled={!editable}
        renderRow={(row, index, update) => (
          <div className="space-y-3">
            <FormField label="Question" required {...fieldProps(errors, `faq-${index}-question`)}>
              <Input
                value={row.question}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.faqQuestion}
                onChange={(change) => update({ question: change.target.value })}
              />
            </FormField>
            <FormField
              label="Answer"
              required
              description={counter(row.answer, CONTENT_LIMITS.faqAnswer)}
              {...fieldProps(errors, `faq-${index}-answer`)}
            >
              <Textarea
                rows={3}
                value={row.answer}
                disabled={!editable}
                onChange={(change) => update({ answer: change.target.value })}
              />
            </FormField>
          </div>
        )}
      />

      <fieldset className="space-y-3 rounded-card border border-line p-4">
        <legend className="px-1 text-base font-semibold text-ink">Contact the organiser</legend>
        <p className="text-sm text-ink-muted">
          Shown on the public event page. Leave both empty to show no contact. Your account email is
          never shown.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Public email"
            description="Shown on the public event page."
            {...fieldProps(errors, 'publicEmail')}
          >
            <Input
              type="email"
              autoComplete="off"
              value={values.publicEmail}
              disabled={!editable}
              onChange={(change) => setField('publicEmail', change.target.value)}
            />
          </FormField>
          <FormField
            label="Public phone"
            description="Shown on the public event page."
            {...fieldProps(errors, 'publicPhone')}
          >
            <Input
              type="tel"
              autoComplete="off"
              value={values.publicPhone}
              disabled={!editable}
              onChange={(change) => setField('publicPhone', change.target.value)}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-card border border-line p-4">
        <legend className="px-1 text-base font-semibold text-ink">Links</legend>
        <p className="text-sm text-ink-muted">
          https addresses only. Each network&apos;s link has to point at that network, so a link
          labelled Instagram always goes to Instagram.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <FormField
              key={network}
              label={SOCIAL_NETWORK_LABELS[network]}
              description={
                network === 'website'
                  ? 'Any https address.'
                  : `https only, on ${SOCIAL_HOSTS[network][0]}.`
              }
              {...fieldProps(errors, `social-${network}`)}
            >
              <Input
                type="url"
                inputMode="url"
                placeholder="https://"
                value={values.socialLinks?.[network] ?? ''}
                disabled={!editable}
                onChange={(change) => setLink(network, change.target.value)}
              />
            </FormField>
          ))}
        </div>
      </fieldset>

      <RepeatableList
        noun="sponsor"
        title="Supported by"
        description="Named on the event page, linked when you give an https website."
        idPrefix="event-sponsors"
        rows={values.sponsors}
        onChange={(rows) => setField('sponsors', rows)}
        blank={() => blankRow('sponsors')}
        max={CONTENT_LIMITS.sponsors}
        disabled={!editable}
        renderRow={(row, index, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Name" required {...fieldProps(errors, `sponsors-${index}-name`)}>
              <Input
                value={row.name}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.sponsorName}
                onChange={(change) => update({ name: change.target.value })}
              />
            </FormField>
            <FormField
              label="Website"
              description="https only."
              {...fieldProps(errors, `sponsors-${index}-url`)}
            >
              <Input
                type="url"
                inputMode="url"
                placeholder="https://"
                value={row.url}
                disabled={!editable}
                onChange={(change) => update({ url: change.target.value })}
              />
            </FormField>
            <FormField
              label="Level"
              description="For example: Gold."
              {...fieldProps(errors, `sponsors-${index}-level`)}
            >
              <Input
                value={row.level}
                disabled={!editable}
                maxLength={CONTENT_LIMITS.sponsorLevel}
                onChange={(change) => update({ level: change.target.value })}
              />
            </FormField>
          </div>
        )}
      />
    </section>
  )
}
