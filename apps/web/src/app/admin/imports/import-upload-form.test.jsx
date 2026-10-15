import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { ImportUploadForm } = await import('./import-upload-form.jsx')

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * A file the input is given.
 *
 * @param {string} text Its contents.
 * @param {string} [name] Its name.
 * @returns {File} The file.
 */
function file(text, name = 'texas-2026.json') {
  return new File([text], name, { type: 'application/json' })
}

beforeEach(() => {
  apiFetch.mockReset()
  push.mockReset()
})

describe('planning an import from a file', () => {
  it('reads the file in the browser and posts its name and data, then opens the plan', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: { id: 'crun0000000000000000001' } }))
    render(<ImportUploadForm maxBytes={2 * 1024 * 1024} />)

    await user.upload(
      screen.getByLabelText(/Listing file/u),
      file('{"format":"desi-event-import/1"}'),
    )
    await user.click(screen.getByRole('button', { name: 'Plan this import' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/imports/crun0000000000000000001'))
    expect(apiFetch).toHaveBeenCalledWith('/v1/platform/imports', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'texas-2026.json',
        dataset: { format: 'desi-event-import/1' },
      }),
    })
  })

  it('refuses a file that is not JSON inline, linked from the summary, and sends nothing', async () => {
    const user = userEvent.setup()

    render(<ImportUploadForm maxBytes={2 * 1024 * 1024} />)

    const input = screen.getByLabelText(/Listing file/u)

    await user.upload(input, file('{ not json'))
    await user.click(screen.getByRole('button', { name: 'Plan this import' }))

    const link = await screen.findByRole('link', { name: /This file is not valid JSON/u })

    expect(link).toHaveAttribute('href', `#${input.id}`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(expect.stringMatching(/not valid JSON/u))
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for a file before sending anything', async () => {
    const user = userEvent.setup()

    render(<ImportUploadForm maxBytes={2 * 1024 * 1024} />)
    await user.click(screen.getByRole('button', { name: 'Plan this import' }))

    expect(
      await screen.findByRole('link', { name: 'Choose a listing file to upload.' }),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('refuses a file larger than one plan can carry before sending it', async () => {
    const user = userEvent.setup()

    render(<ImportUploadForm maxBytes={64} />)
    await user.upload(
      screen.getByLabelText(/Listing file/u),
      file(JSON.stringify({ events: 'x'.repeat(200) })),
    )
    await user.click(screen.getByRole('button', { name: 'Plan this import' }))

    expect(await screen.findByRole('link', { name: /larger than/u })).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('lists every problem the API found with the file', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'IMPORT_INVALID',
          message: 'The import file cannot be used as it is.',
          problems: [
            'events[0].ticketUrl is not an address on the listing’s site.',
            'format is wrong.',
          ],
        },
      }),
    )
    render(<ImportUploadForm maxBytes={2 * 1024 * 1024} />)
    await user.upload(screen.getByLabelText(/Listing file/u), file('{"format":"other"}'))
    await user.click(screen.getByRole('button', { name: 'Plan this import' }))

    expect(await screen.findByText('The import file cannot be used as it is.')).toBeInTheDocument()
    expect(
      screen.getByText('events[0].ticketUrl is not an address on the listing’s site.'),
    ).toBeInTheDocument()
    expect(screen.getByText('format is wrong.')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
