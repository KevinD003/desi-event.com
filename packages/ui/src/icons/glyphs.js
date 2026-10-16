/**
 * The drawings behind {@link Icon}: one self-drawn family.
 *
 * Every glyph sits on a 24-unit grid with a 2-unit margin, is drawn as
 * strokes 1.75 units wide with round caps and joins, in `currentColor`, and
 * has nothing filled except the few dots too small to stroke. One family, one
 * weight, so an icon in a workspace table and one on a poster look like they
 * were drawn by the same hand — they were.
 *
 * Drawn here rather than taken from a package: a few dozen strokes do not
 * justify a dependency, an icon font or sprite from elsewhere would be a
 * request to somebody else's server, and the category glyphs — dandiya
 * sticks, ghungroo, a diya, a thali — exist in no general-purpose set.
 *
 * Each glyph is a list of `[element, attributes]` pairs, rendered in order.
 *
 * @module @desi-event/ui/icons/glyphs
 */

/** A dot too small to stroke, filled in the text colour. */
const dot = (cx, cy, r = 1.1) => ['circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' }]

/**
 * Every glyph, by name.
 *
 * @type {Readonly<Record<string, Array<Array<string|object>>>>}
 */
export const GLYPHS = Object.freeze({
  // Direction.
  'arrow-right': [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  'arrow-left': [['path', { d: 'M19 12H5M11 18l-6-6 6-6' }]],
  'arrow-up-right': [['path', { d: 'M7 17 17 7M9 7h8v8' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-up': [['path', { d: 'm6 15 6-6 6 6' }]],
  'chevron-left': [['path', { d: 'm15 6-6 6 6 6' }]],
  'chevron-right': [['path', { d: 'm9 6 6 6-6 6' }]],
  external: [
    ['path', { d: 'M14 4h6v6M20 4l-8.5 8.5' }],
    [
      'path',
      { d: 'M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10' },
    ],
  ],

  // Actions.
  menu: [['path', { d: 'M4 7h16M4 12h16M4 17h16' }]],
  close: [['path', { d: 'm6 6 12 12M18 6 6 18' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  minus: [['path', { d: 'M5 12h14' }]],
  more: [dot(5, 12, 1.35), dot(12, 12, 1.35), dot(19, 12, 1.35)],
  search: [
    ['circle', { cx: 11, cy: 11, r: 6.5 }],
    ['path', { d: 'm20 20-4.2-4.2' }],
  ],
  filter: [['path', { d: 'M4 5h16l-6 7.5V19l-4 1.5v-8Z' }]],
  sort: [['path', { d: 'M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4' }]],
  copy: [
    ['rect', { x: 8.5, y: 8.5, width: 11.5, height: 11.5, rx: 1.5 }],
    ['path', { d: 'M15.5 8.5v-3a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3' }],
  ],
  download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  upload: [['path', { d: 'M12 15V4M7 9l5-5 5 5M5 20h14' }]],
  edit: [
    ['path', { d: 'M14.5 5.5l4 4M4 20l1-4.5L15.5 5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19Z' }],
  ],
  trash: [['path', { d: 'M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v5M14 11v5' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5' }]],
  settings: [
    ['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }],
    ['circle', { cx: 15, cy: 7, r: 2 }],
    ['circle', { cx: 9, cy: 17, r: 2 }],
  ],

  // Places, people and time.
  home: [['path', { d: 'M4 11 12 4l8 7v9h-5v-6H9v6H4Z' }]],
  pin: [
    ['path', { d: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z' }],
    ['circle', { cx: 12, cy: 10, r: 2.4 }],
  ],
  venue: [['path', { d: 'M4 20.5h16M6 20.5V8.5l6-4.5 6 4.5v12M10 20.5v-5h4v5M9.5 11.5h5' }]],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    [
      'path',
      {
        d: 'M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z',
      },
    ],
  ],
  calendar: [
    ['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2.5 }],
    ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M12 7.5V12l3 2' }],
  ],
  person: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6' }],
  ],
  users: [
    ['circle', { cx: 9, cy: 8, r: 3.5 }],
    ['path', { d: 'M2.5 20c.8-3.3 3.3-5.5 6.5-5.5s5.7 2.2 6.5 5.5' }],
    ['path', { d: 'M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2' }],
  ],
  mail: [
    ['rect', { x: 3.5, y: 5.5, width: 17, height: 13, rx: 2 }],
    ['path', { d: 'm4 7 8 6 8-6' }],
  ],
  phone: [
    [
      'path',
      {
        d: 'M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z',
      },
    ],
  ],
  link: [
    [
      'path',
      {
        d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
      },
    ],
  ],
  access: [
    ['circle', { cx: 12, cy: 4.5, r: 1.8 }],
    ['path', { d: 'M6 8.5h12M12 8.5v5M12 13.5l-3.5 7M12 13.5l3.5 7' }],
  ],
  wheelchair: [
    ['circle', { cx: 11, cy: 4.5, r: 1.8 }],
    ['path', { d: 'M11 7.5v6h5l2.5 5M11 10.5h5M8.2 11.2a5 5 0 1 0 6.9 6.6' }],
  ],

  // Status and trust. Each always travels with a word.
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  'check-circle': [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'm8.5 12.3 2.4 2.4 4.6-4.9' }],
  ],
  'x-circle': [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'm9 9 6 6M15 9l-6 6' }],
  ],
  'alert-triangle': [
    ['path', { d: 'M12 4 21 19.5H3Z' }],
    ['path', { d: 'M12 10v4' }],
    dot(12, 16.9),
  ],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 11v5.5' }], dot(12, 7.9)],
  verified: [
    [
      'path',
      {
        d: 'M12 2.8 14.3 4.5l2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.2l-2.3-1.7-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.1Z',
      },
    ],
    ['path', { d: 'm8.8 12.2 2.2 2.2 4.3-4.6' }],
  ],
  shield: [
    ['path', { d: 'M12 3 5 5.8v5.4c0 4.3 2.9 8 7 9.8 4.1-1.8 7-5.5 7-9.8V5.8Z' }],
    ['path', { d: 'm9.2 12 2 2 3.8-4' }],
  ],
  lock: [
    ['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 10.5V8a4 4 0 0 1 8 0v2.5' }],
  ],
  flag: [['path', { d: 'M5 21V4h11l-2 4 2 4H5' }]],
  eye: [
    ['path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  'eye-off': [
    ['path', { d: 'M3 12s3.5-6 9-6c1.7 0 3.2.6 4.5 1.4M21 12s-3.5 6-9 6c-1.7 0-3.2-.6-4.5-1.4' }],
    ['path', { d: 'M9.9 9.9a3 3 0 0 0 4.2 4.2' }],
    ['path', { d: 'm4 4 16 16' }],
  ],
  bell: [['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 21h4' }]],
  policy: [['path', { d: 'M6.5 3.5h8l4 4v13h-12ZM14.5 3.5v4h4M9.5 12h5M9.5 15.5h5' }]],
  star: [
    ['path', { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z' }],
  ],
  spark: [
    [
      'path',
      { d: 'M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z' },
    ],
  ],

  // Tickets, money and the door.
  ticket: [
    [
      'path',
      {
        d: 'M3.5 8.5V6.8A1.8 1.8 0 0 1 5.3 5h13.4a1.8 1.8 0 0 1 1.8 1.8v1.7a2.5 2.5 0 0 0 0 5v1.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8v-1.7a2.5 2.5 0 0 0 0-5Z',
      },
    ],
    ['path', { d: 'M14.5 5v14', strokeDasharray: '1.5 2.5' }],
  ],
  qr: [
    ['rect', { x: 4, y: 4, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 14, y: 4, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 4, y: 14, width: 6, height: 6, rx: 1 }],
    ['path', { d: 'M14 14h2.5v2.5H14ZM20 14v2.5M14 20h2.5M19.5 19.5H20' }],
  ],
  scan: [
    [
      'path',
      {
        d: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16',
      },
    ],
  ],
  camera: [
    [
      'path',
      {
        d: 'M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z',
      },
    ],
    ['circle', { cx: 12, cy: 12.5, r: 3.5 }],
  ],
  door: [['path', { d: 'M6 20.5v-16a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M4 20.5h16M14.5 12h.01' }]],
  wallet: [
    [
      'path',
      {
        d: 'M19 8H6.5A2.5 2.5 0 0 1 4 5.5v13A2.5 2.5 0 0 0 6.5 21H19a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1Z',
      },
    ],
    ['path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H17v5' }],
    dot(16, 14.5),
  ],
  receipt: [
    ['path', { d: 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5ZM9 8h6M9 11.5h6M9 15h3' }],
  ],
  chart: [['path', { d: 'M4 20h16M7 16v-5M12 16V6M17 16V9' }]],
  inbox: [
    [
      'path',
      { d: 'M3.5 13.5 6 5.5h12l2.5 8v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1ZM3.5 13.5H9l1 2h4l1-2h5.5' },
    ],
  ],

  // Event categories: a glyph for every one the API has.
  mic: [
    ['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }],
    ['path', { d: 'M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6' }],
  ],
  dandiya: [
    ['path', { d: 'M5 19.5 16.8 7.7M19 19.5 7.2 7.7' }],
    ['circle', { cx: 18, cy: 6.5, r: 1.6 }],
    ['circle', { cx: 6, cy: 6.5, r: 1.6 }],
  ],
  bollywood: [
    ['path', { d: 'M10.5 6l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6Z' }],
    ['path', { d: 'M18.5 3v3.5M16.75 4.75h3.5M19 15.5v3M17.5 17h3' }],
  ],
  ghungroo: [
    ['path', { d: 'M4 8.5c2.5 2 5.2 3 8 3s5.5-1 8-3M6.5 10.6v1.9M12 11.5v2M17.5 10.6v1.9' }],
    ['circle', { cx: 6.5, cy: 14.4, r: 1.9 }],
    ['circle', { cx: 12, cy: 15.4, r: 1.9 }],
    ['circle', { cx: 17.5, cy: 14.4, r: 1.9 }],
  ],
  comedy: [
    [
      'path',
      {
        d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4h-.5A1.5 1.5 0 0 1 4 14.5Z',
      },
    ],
    ['path', { d: 'M9 11c1.6 1.4 4.4 1.4 6 0' }],
    dot(9.5, 8),
    dot(14.5, 8),
  ],
  film: [
    ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }],
    ['path', { d: 'M8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4' }],
  ],
  lantern: [
    ['path', { d: 'M12 2.5v3M9 5.5h6l2 4-2 8H9l-2-8ZM7 9.5h10M10 17.5v2.5h4v-2.5M12 20v1.5' }],
  ],
  thali: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['circle', { cx: 8.7, cy: 9.6, r: 2 }],
    ['circle', { cx: 15.3, cy: 9.6, r: 2 }],
    ['circle', { cx: 12, cy: 15.4, r: 2 }],
  ],
  rings: [
    ['circle', { cx: 9, cy: 14, r: 5 }],
    ['circle', { cx: 15, cy: 14, r: 5 }],
    ['path', { d: 'M15 9 13.5 7 15 5l1.5 2Z' }],
  ],
  diya: [
    ['path', { d: 'M4 13h16c-.5 3.5-3.8 6-8 6s-7.5-2.5-8-6ZM9.5 21h5' }],
    [
      'path',
      {
        d: 'M12 4c1.6 1.8 2.2 3.3 1.8 4.6A1.9 1.9 0 0 1 12 10a1.9 1.9 0 0 1-1.8-1.4C9.8 7.3 10.4 5.8 12 4Z',
      },
    ],
  ],
  theatre: [
    [
      'path',
      {
        d: 'M3.5 4h17M5.5 4v16c2.5 0 4.5-3.5 4.5-8S8.5 5.5 7 4M18.5 4v16c-2.5 0-4.5-3.5-4.5-8S15.5 5.5 17 4M3.5 20h17',
      },
    ],
  ],
  workshop: [
    ['rect', { x: 4.5, y: 4, width: 10.5, height: 16, rx: 1.5 }],
    ['path', { d: 'M8 8.5h4M8 12h4M19 5.5v11l-1 2.5-1-2.5v-11Z' }],
  ],
  network: [
    ['circle', { cx: 12, cy: 5.5, r: 2 }],
    ['circle', { cx: 5.5, cy: 17.5, r: 2 }],
    ['circle', { cx: 18.5, cy: 17.5, r: 2 }],
    ['path', { d: 'M11 7.3 6.5 15.7M13 7.3l4.5 8.4M7.5 17.5h9' }],
  ],
  cricket: [
    ['path', { d: 'M3.8 17.8 13.3 8.3l2.4 2.4-9.5 9.5ZM14.6 9.4l4.9-4.9' }],
    ['circle', { cx: 17.5, cy: 17.5, r: 2 }],
  ],
})

/**
 * Every glyph's name, sorted.
 *
 * @returns {string[]} The names.
 */
export function glyphNames() {
  return Object.keys(GLYPHS).sort()
}
