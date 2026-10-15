'use client'

/**
 * Uploading a listing file to plan an import (SPEC2-XI I-H).
 *
 * The file is read here, in the browser, with `File.text()`, and parsed before
 * anything is sent: a file that is not JSON is refused inline, under the
 * field, and linked from the error summary, and nothing leaves the browser.
 * A file that parses is posted as `{ fileName, dataset }` to
 * `POST /v1/platform/imports` through the web's own proxy, with the CSRF
 * header `apiFetch` adds, as a picture upload is. The web app has no Server
 * Actions, and a server page cannot read a file input, so the file is never
 * read on the server page.
 *
 * Planning writes nothing but the plan. The API checks the file again, every
 * listing in it, and answers 422 with each problem it found; those are listed
 * here as it wrote them. A plan that is made opens on its own page, where it
 * can be applied.
 *
 * `@file` rather than `@module`: `import` is a reserved token in a JSDoc
 * namepath.
 *
 * @file app/admin/imports/import-upload-form
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { Button, FormField } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { runPath } from './import-vocabulary.js'

/** How many of the API's problems are listed before "and N more". */
const PROBLEMS_SHOWN = 20

/**
 * The size of a request body in bytes, as the API counts it.
 *
 * @param {string} text The body.
 * @returns {number} Its UTF-8 length.
 */
function byteLength(text) {
  return new TextEncoder().encode(text).length
}

/**
 * Read and parse a chosen file.
 *
 * @param {File} file The file.
 * @returns {Promise<{dataset: unknown}|{problem: string}>} The parsed data, or what is wrong.
 */
export async function readListingFile(file) {
  let text

  try {
    text = await file.text()
  } catch {
    return { problem: 'The file could not be read. Choose it again.' }
  }

  try {
    return { dataset: JSON.parse(text) }
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''

    return { problem: `This file is not valid JSON${detail}. Nothing was sent.` }
  }
}

/**
 * @typedef {object} ImportUploadFormProps
 * @property {number} maxBytes The largest request the API takes for a plan.
 */

/**
 * The form.
 *
 * @param {ImportUploadFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function ImportUploadForm({ maxBytes }) {
  const router = useRouter()
  const id = useId()
  const fileId = `${id}-file`
  const summaryRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const [refusal, setRefusal] = useState(null)

  /**
   * Show what is wrong with the file, and move focus to the summary.
   *
   * @param {string} message The sentence.
   * @returns {void} Nothing.
   */
  function refuseFile(message) {
    setFieldError(message)
    focusAfterRender(summaryRef)
  }

  /**
   * Read, check and send the file.
   *
   * @param {Event} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(submitted) {
    submitted.preventDefault()
    setFieldError(null)
    setRefusal(null)

    if (!file) {
      refuseFile('Choose a listing file to upload.')
      return
    }

    setBusy(true)

    try {
      const read = await readListingFile(file)

      if ('problem' in read) {
        refuseFile(read.problem)
        return
      }

      const body = JSON.stringify({ fileName: file.name.slice(0, 200), dataset: read.dataset })

      if (byteLength(body) > maxBytes) {
        refuseFile(
          `This file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MiB, the most one plan can carry. Split it and upload each part.`,
        )
        return
      }

      const response = await apiFetch('/v1/platform/imports', { method: 'POST', body })
      const parsed = await response.json().catch(() => null)

      if (response.ok && parsed?.data?.id) {
        router.push(runPath(parsed.data.id))
        return
      }

      setRefusal({
        sentence: refusalSentence(
          response.status,
          parsed,
          'The file was not planned.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
        problems: Array.isArray(parsed?.error?.problems) ? parsed.error.problems : [],
      })
      focusAfterRender(summaryRef)
    } catch {
      setRefusal({ sentence: describeApiRefusal(null).detail, problems: [] })
      focusAfterRender(summaryRef)
    } finally {
      setBusy(false)
    }
  }

  const shown = refusal?.problems.slice(0, PROBLEMS_SHOWN) ?? []
  const more = (refusal?.problems.length ?? 0) - shown.length

  return (
    <form onSubmit={send} noValidate className="mt-4 max-w-2xl" aria-label="Plan an import">
      {fieldError || refusal ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          className="mb-4 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:outline-none"
        >
          <h3 className="text-sm font-semibold text-status-danger">The file was not planned</h3>
          {fieldError ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
              <li>
                <a className="underline underline-offset-4" href={`#${fileId}`}>
                  {fieldError}
                </a>
              </li>
            </ul>
          ) : null}
          {refusal ? <p className="mt-1 text-sm text-status-danger">{refusal.sentence}</p> : null}
          {shown.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
              {shown.map((problem, index) => (
                <li key={`${index}-${problem}`}>{problem}</li>
              ))}
              {more > 0 ? <li>{`And ${more} more.`}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <FormField
        label="Listing file"
        id={fileId}
        required
        description="An imported listing file in JSON (desi-event-import/1). Planning it writes nothing but the plan; nothing is imported until you apply it."
        {...(fieldError ? { error: fieldError } : {})}
      >
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(changed) => {
            setFile(changed.target.files?.[0] ?? null)
            setFieldError(null)
          }}
          className="block min-h-11 w-full max-w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line-strong file:bg-surface-raised file:px-4 file:text-sm file:font-semibold file:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        />
      </FormField>

      <div className="mt-4">
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? 'Planning…' : 'Plan this import'}
        </Button>
      </div>
    </form>
  )
}
