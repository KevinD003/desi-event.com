import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const redirect = vi.fn((target) => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { target })
})

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('../../lib/area-gate.js', () => ({ enterArea: vi.fn() }))
vi.mock('../../lib/organizer-api.js', () => ({ getOrganizerEvent: vi.fn() }))
vi.mock('../../lib/request-path.js', () => ({ requestPath: vi.fn() }))
vi.mock('../../components/shells.jsx', () => ({
  AreaRefusal: ({ area }) => <p>refused {area}</p>,
  WorkspaceShell: ({ children }) => <main>{children}</main>,
}))

const { enterArea } = await import('../../lib/area-gate.js')
const { getOrganizerEvent } = await import('../../lib/organizer-api.js')
const { requestPath } = await import('../../lib/request-path.js')
const { default: OrganizerLayout } = await import('./layout.jsx')

const ADMIN = {
  user: { id: 'u1' },
  capabilities: ['event:platform_edit', 'event:view_draft', 'organizer:invite'],
  memberships: [],
}

const OWNER = {
  user: { id: 'u2' },
  capabilities: [],
  memberships: [{ organizationId: 'org_1', role: 'OWNER', capabilities: ['event:create'] }],
}

beforeEach(() => {
  redirect.mockClear()
  getOrganizerEvent.mockReset()
  requestPath.mockReset()
})

describe('the organiser area’s layout', () => {
  it('sends a platform administrator who is not a member to the editor for the team at The Desi Events', async () => {
    enterArea.mockResolvedValue({ session: ADMIN, admitted: false })
    requestPath.mockResolvedValue('/organizer/events/cevent1')
    getOrganizerEvent.mockResolvedValue({ id: 'cevent1', organizationId: 'org_1' })

    await expect(OrganizerLayout({ children: <p>editor</p> })).rejects.toMatchObject({
      target: '/admin/events/cevent1',
    })
    expect(getOrganizerEvent).toHaveBeenCalledWith('cevent1')
  })

  it('leaves the organiser in their own editor, without reading the event again', async () => {
    enterArea.mockResolvedValue({ session: OWNER, admitted: true })
    requestPath.mockResolvedValue('/organizer/events/cevent1')

    render(await OrganizerLayout({ children: <p>editor</p> }))

    expect(screen.getByText('editor')).toBeInTheDocument()
    expect(getOrganizerEvent).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('leaves a platform administrator elsewhere in the area to the area’s own rule', async () => {
    enterArea.mockResolvedValue({ session: ADMIN, admitted: false })
    requestPath.mockResolvedValue('/organizer/events/new')

    render(await OrganizerLayout({ children: <p>editor</p> }))

    expect(screen.getByText('refused organizer')).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('does not send anybody anywhere when the event cannot be read', async () => {
    enterArea.mockResolvedValue({ session: ADMIN, admitted: false })
    requestPath.mockResolvedValue('/organizer/events/cevent9')
    getOrganizerEvent.mockRejectedValue(Object.assign(new Error('No such event.'), { status: 404 }))

    render(await OrganizerLayout({ children: <p>editor</p> }))

    expect(redirect).not.toHaveBeenCalled()
  })
})
