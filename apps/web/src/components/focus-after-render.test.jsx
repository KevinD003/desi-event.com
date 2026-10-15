/**
 * Focus lands on what a state change draws, whatever priority that change has.
 *
 * The case this exists for is the one `queueMicrotask(focus)` got wrong: a
 * refusal drawn after an `await`, which React renders in a later task than the
 * microtask. The other cases pin that nothing a click handler relied on was
 * lost on the way.
 *
 * The static check at the end keeps the old line from coming back: every
 * component moves focus through this hook, so none of them can reach for a
 * microtask again without this suite noticing.
 *
 * @module components/focus-after-render.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useFocusAfterRender } from './focus-after-render.jsx'

/**
 * A button that waits on a promise, then draws a refusal and asks for focus on it.
 *
 * @param {object} props Component props.
 * @param {Function} props.wait What to wait for before refusing.
 * @returns {JSX.Element} The button, and the refusal once there is one.
 */
function RefusesLater({ wait }) {
  const [refusals, setRefusals] = useState(0)
  const refusalRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          setRefusals(0)
          await wait()
          setRefusals((count) => count + 1)
          focusAfterRender(refusalRef)
        }}
      >
        Send
      </button>
      {refusals > 0 ? (
        <div ref={refusalRef} tabIndex={-1} data-testid="refusal">
          Refused {refusals}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A disclosure: the opener goes while the panel is open, and comes back when it closes.
 *
 * @param {object} props Component props.
 * @param {Function} props.wait What to wait for before closing.
 * @returns {JSX.Element} The opener or the panel.
 */
function Disclosure({ wait }) {
  const [open, setOpen] = useState(false)
  const openerRef = useRef(null)
  const panelRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  return open ? (
    <div ref={panelRef} tabIndex={-1} role="group" aria-label="Panel">
      <button
        type="button"
        onClick={async () => {
          await wait()
          setOpen(false)
          focusAfterRender(openerRef)
        }}
      >
        Save
      </button>
    </div>
  ) : (
    <button
      ref={openerRef}
      type="button"
      onClick={() => {
        setOpen(true)
        focusAfterRender(panelRef)
      }}
    >
      Open
    </button>
  )
}

describe('useFocusAfterRender', () => {
  it('focuses a refusal that is only drawn after an await', async () => {
    const user = userEvent.setup()

    render(<RefusesLater wait={() => new Promise((resolve) => setTimeout(resolve, 5))} />)
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const refusal = await screen.findByTestId('refusal')

    await waitFor(() => expect(refusal).toHaveFocus())
  })

  it('focuses the same refusal again when it is refused twice in a row', async () => {
    const user = userEvent.setup()

    render(<RefusesLater wait={() => Promise.resolve()} />)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByTestId('refusal')).toHaveFocus())

    // Focus moves away, and the next refusal brings it back.
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('Refused 1')).toHaveFocus())
  })

  it('opens a panel from a click and hands focus back to its opener after an await', async () => {
    const user = userEvent.setup()

    render(<Disclosure wait={() => new Promise((resolve) => setTimeout(resolve, 5))} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(screen.getByRole('group', { name: 'Panel' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus())
  })

  it('takes a function that finds the element once it is drawn', async () => {
    const user = userEvent.setup()

    /**
     * One of several buttons, found by name when focus is due.
     *
     * @returns {JSX.Element} The buttons.
     */
    function Finder() {
      const [shown, setShown] = useState(false)
      const buttons = useRef({})
      const focusAfterRender = useFocusAfterRender()

      return (
        <div>
          <button
            type="button"
            onClick={async () => {
              await Promise.resolve()
              setShown(true)
              focusAfterRender(() => buttons.current.second)
            }}
          >
            Show
          </button>
          {shown
            ? ['first', 'second'].map((key) => (
                <button
                  key={key}
                  type="button"
                  ref={(element) => {
                    buttons.current[key] = element
                  }}
                >
                  {key}
                </button>
              ))
            : null}
        </div>
      )
    }

    render(<Finder />)
    await user.click(screen.getByRole('button', { name: 'Show' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'second' })).toHaveFocus())
  })

  it('keeps a request made before the last commit’s effects ran, as a press does that lands while the page hydrates', () => {
    /**
     * A panel opened before the commit that drew its opener has run its
     * effects: what a press does when it reaches a button React has hydrated
     * but whose effects have not run yet. A layout effect is the same window,
     * made on purpose.
     *
     * @returns {JSX.Element} The opener or the panel.
     */
    function OpenedEarly() {
      const [open, setOpen] = useState(false)
      const headingRef = useRef(null)
      const focusAfterRender = useFocusAfterRender()

      useLayoutEffect(() => {
        setOpen(true)
        focusAfterRender(headingRef)
      }, [focusAfterRender])

      return open ? (
        <h3 ref={headingRef} tabIndex={-1}>
          Restore
        </h3>
      ) : (
        <button type="button">Restore…</button>
      )
    }

    render(<OpenedEarly />)

    // The effects of the commit before the panel was drawn found no heading;
    // the request waited for the commit that drew it.
    expect(screen.getByRole('heading', { name: 'Restore' })).toHaveFocus()
  })
})

/** The web application's source directory. */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every shipped module under a directory: tests are left out.
 *
 * @param {string} directory Where to look.
 * @returns {string[]} Absolute paths.
 */
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name)

    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.(js|jsx)$/u.test(name) || /\.test\.(js|jsx)$/u.test(name)) return []

    return [full]
  })
}

describe('moving focus in the web application', () => {
  it('never defers focus to a microtask, which runs before an update made after an await is drawn', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')

      return [...source.matchAll(/queueMicrotask\(([^;]*?)\)\s*$/gmu)]
        .filter(([, callback]) => callback.includes('.focus('))
        .map(({ index }) => {
          const line = source.slice(0, index).split('\n').length

          return `${path.relative(SRC, file)}:${line}`
        })
    })

    expect(offenders).toEqual([])
  })
})
