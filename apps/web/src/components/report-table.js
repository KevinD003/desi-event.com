/**
 * How a report's tables are styled, written once.
 *
 * The analytics page and its visit tables (`traffic-tables.jsx`) draw many
 * small tables side by side: sales, inventory, visits per day, sources. They
 * read as one report only if every one has the same rules, headers and
 * number alignment, so the classes live here rather than in each file. Plain
 * strings in semantic tokens, so a server component can use them without a
 * client boundary.
 *
 * Numbers are right-aligned in tabular figures, so a column of counts lines up
 * by place value and can be compared at a glance.
 *
 * @module components/report-table
 */

/** The table itself. */
export const TABLE = 'min-w-full border-collapse text-sm'

/** A column header. */
export const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A numeric column header, right-aligned over its numbers. */
export const TH_NUM = `${TH} text-right`

/** An ordinary cell. */
export const TD = 'border-b border-line px-3 py-2 text-ink'

/** A row header: a cell's padding and rule, at body weight. */
export const ROW_TH = `${TD} font-normal`

/** A cell holding a count or an amount. */
export const NUM = `${TD} text-right tabular-nums`

/** The caption every table carries, which a screen reader announces on entering it. */
export const CAPTION = 'px-3 py-2 text-left text-sm font-semibold text-ink'
