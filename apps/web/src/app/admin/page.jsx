/**
 * The top of platform administration: there is nothing here of its own, so it
 * sends the reader to the first section their session is offered.
 *
 * For a platform administrator that is Organiser invitations, and for a super
 * administrator too — it is the work the area exists for now. A session the
 * area does not admit never reaches this: the layout draws its refusal first,
 * and a signed-out visitor is sent to sign in by the layout.
 *
 * @module app/admin/page
 */

import { redirect } from 'next/navigation'

import { adminTabs } from '../../lib/area-tabs.js'
import { AREAS } from '../../lib/areas.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Platform administration',
  robots: { index: false, follow: false },
}

/**
 * Send the reader on.
 *
 * @returns {Promise<never>} Never resolves: `redirect` ends the render.
 */
export default async function AdminPage() {
  const session = await readSession()

  redirect(adminTabs(session)[0]?.href ?? AREAS.admin.href)
}
