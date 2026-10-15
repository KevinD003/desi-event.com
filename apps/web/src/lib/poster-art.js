/**
 * Original poster art for an event, drawn from its slug.
 *
 * Every event on the site gets an illustration without anybody uploading one:
 * garba dancers circling a lit garbo under string lights, a pair of dandiya
 * sticks over a mandala, or a festival toran — chosen by category and varied by
 * a seed, so the same event always draws the same picture and two events on one
 * page rarely draw the same one. Nothing here is a photograph or anybody else's
 * artwork; it is geometry, generated.
 *
 * The output is a small element tree, not markup: `{ tag, attrs, children }`.
 * `EventPoster` renders it as React elements, and {@link toSvgString} writes it
 * as a standalone SVG file (the design canvas uses those). Every attribute
 * value comes from this module — numbers and the palette constants below — so
 * nothing an organiser typed can reach the drawing.
 *
 * @module lib/poster-art
 */

/** The drawing's coordinate space: 3:2, cropped to fit by the container. */
export const POSTER_VIEWBOX = Object.freeze({ width: 600, height: 400 })

/**
 * Every element a drawing may contain: shapes, groups and gradient
 * definitions, and nothing that can hold text, script, a link or a foreign
 * document. `EventPoster` renders only these, and a test holds every drawing
 * to them, so a new shape has to be added here on purpose.
 */
export const POSTER_ELEMENTS = Object.freeze([
  'circle',
  'defs',
  'ellipse',
  'g',
  'line',
  'linearGradient',
  'path',
  'radialGradient',
  'rect',
  'stop',
])

/**
 * The illustration palette: every colour a poster is drawn in.
 *
 * These are artwork, not interface. No poster colour is ever text, a ground
 * for text or a control, so they sit outside the theme's semantic tokens, and
 * this table is the one place in the web app's code where a hex value may be
 * written: `packages/config/tests/semantic-classes.test.js` finds this
 * declaration and fails on any hex elsewhere in the file.
 *
 * `shared` is what every scheme uses alike: the white of a star, a mirror or a
 * bulb's glint, the shadow of the wire the lights hang on, the fired clay of a
 * garbo and of a diya, and a flame's two colours. Each of `schemes` is a night
 * or dusk sky and five festival colours: `sky` runs top to bottom; `glow` is
 * the lamp's warmth; `ink` is the dancers' silhouette; `accents` dress the
 * skirts, the lights and the bunting.
 */
const PALETTES = Object.freeze({
  shared: Object.freeze({
    light: '#ffffff',
    wire: '#000000',
    garboClay: '#b5532b',
    diyaClay: '#c2562d',
    flame: '#ffd166',
    flameCore: '#fff4d6',
  }),
  schemes: Object.freeze([
    {
      name: 'navratri-night',
      sky: ['#1b0f35', '#3b1552'],
      glow: '#ffb347',
      ink: '#12091f',
      accents: ['#e0457b', '#f7b32b', '#1fb5a5', '#3f5bd8', '#2ba84a'],
    },
    {
      name: 'sunset-raas',
      sky: ['#3a0f3d', '#b8452e'],
      glow: '#ffd166',
      ink: '#1f0a1c',
      accents: ['#ffd166', '#ff8fab', '#7fdbca', '#f25c54', '#9d4edd'],
    },
    {
      name: 'peacock',
      sky: ['#062b36', '#0e5e6f'],
      glow: '#ffc857',
      ink: '#03161c',
      accents: ['#f7b32b', '#e0457b', '#9be564', '#48cae4', '#ff7b54'],
    },
    {
      name: 'royal-durbar',
      sky: ['#14103d', '#2e2a7a'],
      glow: '#ffbe5c',
      ink: '#0b0826',
      accents: ['#f28f3b', '#e94f6f', '#ffd166', '#5bd1d7', '#c77dff'],
    },
    {
      name: 'kesari',
      sky: ['#4a0f1c', '#c2410c'],
      glow: '#ffe066',
      ink: '#240610',
      accents: ['#ffe066', '#2ec4b6', '#f8f4e3', '#ff5d8f', '#6a4c93'],
    },
  ]),
})

/**
 * What every drawing function is handed.
 *
 * @typedef {object} DrawingContext
 * @property {function(): number} random The seeded generator.
 * @property {object} palette One of the palette's schemes.
 * @property {object} shared The colours every scheme shares.
 * @property {string} id Prefix for this poster's gradient ids.
 * @property {number} width The drawing's width.
 * @property {number} height The drawing's height.
 * @property {boolean} hero Whether to draw the fuller hero scene.
 * @property {number} glowY Where the lamp glow sits.
 */

/**
 * A 32-bit hash of a string (FNV-1a).
 *
 * @param {string} text Anything.
 * @returns {number} An unsigned 32-bit integer.
 */
function hashString(text) {
  let hash = 0x811c9dc5

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/**
 * A small seeded generator (mulberry32): the same seed, the same sequence.
 *
 * @param {number} seed A 32-bit integer.
 * @returns {function(): number} Returns a number in [0, 1).
 */
function seededRandom(seed) {
  let state = seed >>> 0

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Round for the output, so a poster is not a wall of seventeen-digit floats.
 *
 * @param {number} value A coordinate.
 * @returns {number} It, to one decimal place.
 */
function r1(value) {
  return Math.round(value * 10) / 10
}

/**
 * An element of the drawing.
 *
 * @param {string} tag An SVG element name.
 * @param {Record<string, string|number>} [attrs] Its attributes, in SVG spelling.
 * @param {Array<object>} [children] Nested elements.
 * @returns {{tag: string, attrs: Record<string, string|number>, children: Array<object>}} The node.
 */
function el(tag, attrs = {}, children = []) {
  return { tag, attrs, children }
}

/**
 * A number between two others.
 *
 * @param {function(): number} random The generator.
 * @param {number} low Inclusive.
 * @param {number} high Exclusive.
 * @returns {number} A value in [low, high).
 */
function between(random, low, high) {
  return low + random() * (high - low)
}

/**
 * The sky, its lamp glow and a scatter of stars.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} Background elements.
 */
function sky(context) {
  const { random, palette, shared, id, width, height, glowY } = context
  const stars = []

  for (let index = 0; index < 26; index += 1) {
    stars.push(
      el('circle', {
        cx: r1(between(random, 0, width)),
        cy: r1(between(random, 0, height * 0.55)),
        r: r1(between(random, 0.6, 1.8)),
        fill: shared.light,
        'fill-opacity': r1(between(random, 0.25, 0.7) * 10) / 10,
      }),
    )
  }

  return [
    el('defs', {}, [
      el('linearGradient', { id: `${id}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, [
        el('stop', { offset: '0%', 'stop-color': palette.sky[0] }),
        el('stop', { offset: '100%', 'stop-color': palette.sky[1] }),
      ]),
      el('radialGradient', { id: `${id}-glow`, cx: '50%', cy: '50%', r: '50%' }, [
        el('stop', { offset: '0%', 'stop-color': palette.glow, 'stop-opacity': 0.75 }),
        el('stop', { offset: '45%', 'stop-color': palette.glow, 'stop-opacity': 0.22 }),
        el('stop', { offset: '100%', 'stop-color': palette.glow, 'stop-opacity': 0 }),
      ]),
    ]),
    el('rect', { width, height, fill: `url(#${id}-sky)` }),
    el('g', {}, stars),
    el('ellipse', {
      cx: width / 2,
      cy: glowY,
      rx: width * 0.46,
      ry: height * 0.42,
      fill: `url(#${id}-glow)`,
    }),
  ]
}

/**
 * Strings of festival lights, sagging across the top.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} Wires and bulbs.
 */
function stringLights(context) {
  const { random, palette, shared, width } = context
  const out = []
  const strands = 2 + Math.floor(random() * 2)

  for (let strand = 0; strand < strands; strand += 1) {
    const y0 = between(random, 8, 34) + strand * 16
    const y1 = between(random, 8, 34) + strand * 16
    const sag = between(random, 28, 58)
    const cx = width / 2
    const cy = (y0 + y1) / 2 + sag

    out.push(
      el('path', {
        d: `M -10 ${r1(y0)} Q ${r1(cx)} ${r1(cy)} ${width + 10} ${r1(y1)}`,
        fill: 'none',
        stroke: shared.wire,
        'stroke-opacity': 0.35,
        'stroke-width': 1.2,
      }),
    )

    const bulbs = 14 + Math.floor(random() * 6)

    for (let index = 1; index < bulbs; index += 1) {
      const t = index / bulbs
      const x = (1 - t) * (1 - t) * -10 + 2 * (1 - t) * t * cx + t * t * (width + 10)
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1
      const colour = palette.accents[(index + strand) % palette.accents.length]

      out.push(
        el('circle', { cx: r1(x), cy: r1(y + 5), r: 7, fill: colour, 'fill-opacity': 0.22 }),
        el('circle', { cx: r1(x), cy: r1(y + 5), r: 2.6, fill: colour }),
      )
    }
  }

  return [el('g', {}, out)]
}

/**
 * A toran of triangular bunting along the top edge.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} The line and its flags.
 */
function toran(context) {
  const { random, palette, shared, width } = context
  const flags = []
  const count = 16
  const step = width / count
  const drop = between(random, 4, 10)

  for (let index = 0; index < count; index += 1) {
    const x = index * step
    const colour = palette.accents[index % palette.accents.length]

    flags.push(
      el('path', {
        d: `M ${r1(x + 2)} ${r1(drop)} L ${r1(x + step - 2)} ${r1(drop)} L ${r1(x + step / 2)} ${r1(drop + 26)} Z`,
        fill: colour,
      }),
      el('circle', {
        cx: r1(x + step / 2),
        cy: r1(drop + 9),
        r: 2.2,
        fill: shared.light,
        'fill-opacity': 0.85,
      }),
    )
  }

  return [
    el('g', {}, [
      el('line', {
        x1: 0,
        y1: r1(drop),
        x2: width,
        y2: r1(drop),
        stroke: palette.glow,
        'stroke-width': 2,
      }),
      ...flags,
    ]),
  ]
}

/**
 * A garbo: the pierced clay pot with a lamp inside, the centre of the circle.
 *
 * @param {DrawingContext} context The drawing context.
 * @param {number} cx Centre x.
 * @param {number} baseY Where it stands.
 * @param {number} scale Its size.
 * @returns {Array<object>} The pot, its holes and the flame.
 */
function garbo(context, cx, baseY, scale) {
  const { palette, shared } = context
  const w = 34 * scale
  const h = 40 * scale
  const holes = []

  for (let row = 0; row < 3; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      holes.push(
        el('circle', {
          cx: r1(cx + col * 6 * scale + (row % 2) * 3 * scale),
          cy: r1(baseY - h * 0.28 - row * 7 * scale),
          r: r1(1.6 * scale),
          fill: palette.glow,
        }),
      )
    }
  }

  return [
    el('ellipse', {
      cx,
      cy: r1(baseY - h * 0.45),
      rx: r1(w * 1.9),
      ry: r1(h * 1.4),
      fill: palette.glow,
      'fill-opacity': 0.18,
    }),
    el('path', {
      d: [
        `M ${r1(cx - w * 0.3)} ${r1(baseY - h)}`,
        `C ${r1(cx - w * 0.9)} ${r1(baseY - h * 0.75)} ${r1(cx - w * 0.75)} ${r1(baseY)} ${r1(cx)} ${r1(baseY)}`,
        `C ${r1(cx + w * 0.75)} ${r1(baseY)} ${r1(cx + w * 0.9)} ${r1(baseY - h * 0.75)} ${r1(cx + w * 0.3)} ${r1(baseY - h)}`,
        'Z',
      ].join(' '),
      fill: shared.garboClay,
    }),
    el('rect', {
      x: r1(cx - w * 0.34),
      y: r1(baseY - h - 4 * scale),
      width: r1(w * 0.68),
      height: r1(5 * scale),
      rx: r1(2 * scale),
      fill: palette.accents[1],
    }),
    ...holes,
    el('path', {
      d: `M ${r1(cx)} ${r1(baseY - h - 26 * scale)} C ${r1(cx + 9 * scale)} ${r1(baseY - h - 12 * scale)} ${r1(cx + 7 * scale)} ${r1(baseY - h - 3 * scale)} ${r1(cx)} ${r1(baseY - h - 3 * scale)} C ${r1(cx - 7 * scale)} ${r1(baseY - h - 3 * scale)} ${r1(cx - 9 * scale)} ${r1(baseY - h - 12 * scale)} ${r1(cx)} ${r1(baseY - h - 26 * scale)} Z`,
      fill: shared.flame,
    }),
    el('path', {
      d: `M ${r1(cx)} ${r1(baseY - h - 17 * scale)} C ${r1(cx + 4 * scale)} ${r1(baseY - h - 9 * scale)} ${r1(cx + 3 * scale)} ${r1(baseY - h - 5 * scale)} ${r1(cx)} ${r1(baseY - h - 5 * scale)} C ${r1(cx - 3 * scale)} ${r1(baseY - h - 5 * scale)} ${r1(cx - 4 * scale)} ${r1(baseY - h - 9 * scale)} ${r1(cx)} ${r1(baseY - h - 17 * scale)} Z`,
      fill: shared.flameCore,
    }),
  ]
}

/**
 * One dancer: a flared chaniya with mirror-work, a blouse, raised arms and a
 * dandiya stick in each hand.
 *
 * @param {DrawingContext} context The drawing context.
 * @param {number} x Feet, horizontally.
 * @param {number} y Feet, vertically.
 * @param {number} scale Size, smaller at the back of the circle.
 * @param {string} skirt The chaniya's colour.
 * @param {string} trim The hem and blouse colour.
 * @param {number} lean -1 to 1: which way the turn is going.
 * @returns {object} A group.
 */
function dancer(context, x, y, scale, skirt, trim, lean) {
  const { random, palette, shared } = context
  const s = scale
  const hipY = y - 30 * s
  const shoulderY = y - 50 * s
  const headY = y - 60 * s
  const flare = 22 * s * (0.9 + random() * 0.35)
  const swing = lean * 6 * s
  const mirrors = []

  for (let index = -2; index <= 2; index += 1) {
    mirrors.push(
      el('circle', {
        cx: r1(x + swing * 0.6 + index * flare * 0.34),
        cy: r1(y - 6 * s - Math.abs(index) * 1.5 * s),
        r: r1(1.3 * s),
        fill: shared.light,
        'fill-opacity': 0.9,
      }),
    )
  }

  const armLift = between(random, 0.55, 1)
  const leftHand = [x - 17 * s + swing * 0.2, shoulderY - 16 * s * armLift]
  const rightHand = [x + 17 * s + swing * 0.2, shoulderY - 16 * s * (1.4 - armLift)]
  const stick = (hand, angle) => {
    const length = 12 * s

    return el('line', {
      x1: r1(hand[0] - Math.cos(angle) * length * 0.5),
      y1: r1(hand[1] - Math.sin(angle) * length * 0.5),
      x2: r1(hand[0] + Math.cos(angle) * length * 0.5),
      y2: r1(hand[1] + Math.sin(angle) * length * 0.5),
      stroke: palette.accents[1],
      'stroke-width': r1(2.2 * s),
      'stroke-linecap': 'round',
    })
  }

  return el('g', {}, [
    el('path', {
      d: [
        `M ${r1(x - 6 * s)} ${r1(hipY)}`,
        `Q ${r1(x - flare * 0.7 + swing)} ${r1(y - 14 * s)} ${r1(x - flare + swing)} ${r1(y)}`,
        `Q ${r1(x + swing)} ${r1(y + 5 * s)} ${r1(x + flare + swing)} ${r1(y)}`,
        `Q ${r1(x + flare * 0.7 + swing)} ${r1(y - 14 * s)} ${r1(x + 6 * s)} ${r1(hipY)}`,
        'Z',
      ].join(' '),
      fill: skirt,
    }),
    el('path', {
      d: `M ${r1(x - flare + swing)} ${r1(y)} Q ${r1(x + swing)} ${r1(y + 5 * s)} ${r1(x + flare + swing)} ${r1(y)}`,
      fill: 'none',
      stroke: trim,
      'stroke-width': r1(3 * s),
    }),
    ...mirrors,
    el('path', {
      d: `M ${r1(x - 7 * s)} ${r1(hipY)} L ${r1(x - 6 * s)} ${r1(shoulderY)} L ${r1(x + 6 * s)} ${r1(shoulderY)} L ${r1(x + 7 * s)} ${r1(hipY)} Z`,
      fill: trim,
    }),
    el('path', {
      d: `M ${r1(x - 6 * s)} ${r1(shoulderY + s)} L ${r1(leftHand[0])} ${r1(leftHand[1])} M ${r1(x + 6 * s)} ${r1(shoulderY + s)} L ${r1(rightHand[0])} ${r1(rightHand[1])}`,
      fill: 'none',
      stroke: palette.ink,
      'stroke-width': r1(3.2 * s),
      'stroke-linecap': 'round',
    }),
    stick(leftHand, -0.9),
    stick(rightHand, 0.9),
    el('circle', { cx: r1(x + swing * 0.1), cy: r1(headY), r: r1(6.5 * s), fill: palette.ink }),
    el('path', {
      d: `M ${r1(x - 6 * s)} ${r1(headY - s)} Q ${r1(x - 2 * s)} ${r1(headY + 14 * s)} ${r1(x - 10 * s + swing)} ${r1(hipY)}`,
      fill: 'none',
      stroke: palette.ink,
      'stroke-width': r1(3 * s),
      'stroke-linecap': 'round',
    }),
  ])
}

/**
 * The garba circle: dancers on an ellipse around the garbo, the far side
 * smaller and drawn first so the near side overlaps it.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} The circle.
 */
function garbaCircle(context) {
  const { random, palette, width, height, hero } = context
  const count = hero ? 10 : 7 + Math.floor(random() * 3)
  const cx = width / 2
  const cy = height * 0.74
  const rx = width * (hero ? 0.39 : 0.35)
  const ry = height * 0.12
  const turn = random() * Math.PI * 2
  const placed = []

  for (let index = 0; index < count; index += 1) {
    const angle = turn + (index / count) * Math.PI * 2
    const depth = (Math.sin(angle) + 1) / 2
    placed.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      scale: 1.05 + depth * 0.62,
      lean: Math.cos(angle + Math.PI / 2) > 0 ? 1 : -1,
      depth,
      skirt: palette.accents[index % palette.accents.length],
      trim: palette.accents[(index + 2) % palette.accents.length],
    })
  }

  placed.sort((left, right) => left.depth - right.depth)

  const back = placed.filter((item) => item.depth < 0.5)
  const front = placed.filter((item) => item.depth >= 0.5)
  const draw = (item) =>
    dancer(context, item.x, item.y, item.scale, item.skirt, item.trim, item.lean)

  return [
    el('ellipse', {
      cx,
      cy: r1(cy + 14),
      rx: r1(rx + 70),
      ry: r1(ry + 26),
      fill: palette.glow,
      'fill-opacity': 0.14,
    }),
    el('ellipse', {
      cx,
      cy: r1(cy + 12),
      rx: r1(rx + 24),
      ry: r1(ry + 10),
      fill: palette.glow,
      'fill-opacity': 0.12,
    }),
    ...back.map(draw),
    ...garbo(context, cx, cy + 4, hero ? 1.6 : 1.4),
    ...front.map(draw),
  ]
}

/**
 * A mandala of petal rings, in the palette's colours.
 *
 * @param {DrawingContext} context The drawing context.
 * @param {number} cx Centre x.
 * @param {number} cy Centre y.
 * @param {number} size Outer radius.
 * @returns {Array<object>} The rings.
 */
function mandala(context, cx, cy, size) {
  const { random, palette, shared } = context
  const rings = []
  const layers = 4

  for (let layer = layers; layer >= 1; layer -= 1) {
    const radius = (size * layer) / layers
    const petals = 8 + layer * 4
    const colour = palette.accents[(layer + Math.floor(random() * 5)) % palette.accents.length]
    const petalsOut = []

    for (let index = 0; index < petals; index += 1) {
      const angle = (index / petals) * Math.PI * 2
      const tipX = cx + Math.cos(angle) * radius
      const tipY = cy + Math.sin(angle) * radius
      const inner = radius * 0.62
      const side = (Math.PI / petals) * 0.9
      const aX = cx + Math.cos(angle - side) * inner
      const aY = cy + Math.sin(angle - side) * inner
      const bX = cx + Math.cos(angle + side) * inner
      const bY = cy + Math.sin(angle + side) * inner

      petalsOut.push(
        el('path', {
          d: `M ${r1(aX)} ${r1(aY)} Q ${r1(tipX)} ${r1(tipY)} ${r1(bX)} ${r1(bY)} Z`,
          fill: colour,
          'fill-opacity': layer === layers ? 0.55 : 0.85,
        }),
      )
    }

    rings.push(el('g', {}, petalsOut))
    rings.push(
      el('circle', {
        cx,
        cy,
        r: r1(radius * 0.6),
        fill: 'none',
        stroke: shared.light,
        'stroke-opacity': 0.35,
        'stroke-width': 1.2,
        'stroke-dasharray': '2 5',
      }),
    )
  }

  rings.push(el('circle', { cx, cy, r: r1(size * 0.12), fill: palette.glow }))

  return rings
}

/**
 * Crossed dandiya pairs, ribboned, over a mandala.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} The sticks and their mandala.
 */
function dandiyaSticks(context) {
  const { palette, width, height } = context
  const cx = width / 2
  const cy = height * 0.58
  const sticks = []
  const pairs = [
    { angle: 0, offset: -120, colour: palette.accents[0] },
    { angle: 0, offset: 120, colour: palette.accents[2] },
  ]

  for (const pair of pairs) {
    for (const cross of [-0.5, 0.5]) {
      const angle = pair.angle + cross
      const length = 190
      const x = cx + pair.offset
      const x1 = x - Math.sin(angle) * length * 0.5
      const y1 = cy + Math.cos(angle) * length * 0.5
      const x2 = x + Math.sin(angle) * length * 0.5
      const y2 = cy - Math.cos(angle) * length * 0.5

      sticks.push(
        el('line', {
          x1: r1(x1),
          y1: r1(y1),
          x2: r1(x2),
          y2: r1(y2),
          stroke: pair.colour,
          'stroke-width': 9,
          'stroke-linecap': 'round',
        }),
        el('line', {
          x1: r1(x1),
          y1: r1(y1),
          x2: r1(x2),
          y2: r1(y2),
          stroke: palette.accents[1],
          'stroke-width': 9,
          'stroke-linecap': 'round',
          'stroke-dasharray': '6 12',
        }),
        el('circle', { cx: r1(x2), cy: r1(y2), r: 6, fill: palette.glow }),
      )
    }
  }

  return [...mandala(context, cx, cy, 140), el('g', {}, sticks)]
}

/**
 * A band of mirror-work along the bottom edge: diamonds and discs.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} The band.
 */
function mirrorBand(context) {
  const { palette, shared, width, height } = context
  const out = [
    el('rect', {
      x: 0,
      y: height - 22,
      width,
      height: 22,
      fill: palette.ink,
      'fill-opacity': 0.85,
    }),
  ]
  const step = 24

  for (let x = step / 2, index = 0; x < width; x += step, index += 1) {
    const colour = palette.accents[index % palette.accents.length]
    const cy = height - 11

    out.push(
      el('path', {
        d: `M ${r1(x)} ${cy - 7} L ${r1(x + 7)} ${cy} L ${r1(x)} ${cy + 7} L ${r1(x - 7)} ${cy} Z`,
        fill: colour,
      }),
      el('circle', { cx: r1(x), cy, r: 2.4, fill: shared.light, 'fill-opacity': 0.9 }),
    )
  }

  return [el('g', {}, out)]
}

/**
 * Kandil lanterns hanging from the top edge on strings.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} Strings and lanterns.
 */
function lanterns(context) {
  const { random, palette, shared, width } = context
  const out = []
  const count = 5

  for (let index = 0; index < count; index += 1) {
    const x = ((index + 0.5) / count) * width + between(random, -18, 18)
    const drop = between(random, 70, 150)
    const colour = palette.accents[index % palette.accents.length]
    const w = 26
    const h = 34

    out.push(
      el('line', {
        x1: r1(x),
        y1: 0,
        x2: r1(x),
        y2: r1(drop - h / 2),
        stroke: palette.glow,
        'stroke-opacity': 0.7,
        'stroke-width': 1.2,
      }),
      el('ellipse', {
        cx: r1(x),
        cy: r1(drop),
        rx: r1(w * 1.4),
        ry: r1(h * 1.2),
        fill: colour,
        'fill-opacity': 0.18,
      }),
      el('path', {
        d: `M ${r1(x)} ${r1(drop - h / 2)} L ${r1(x + w / 2)} ${r1(drop)} L ${r1(x)} ${r1(drop + h / 2)} L ${r1(x - w / 2)} ${r1(drop)} Z`,
        fill: colour,
      }),
      el('path', {
        d: `M ${r1(x)} ${r1(drop - h / 2)} L ${r1(x + w / 4)} ${r1(drop)} L ${r1(x)} ${r1(drop + h / 2)} L ${r1(x - w / 4)} ${r1(drop)} Z`,
        fill: shared.light,
        'fill-opacity': 0.28,
      }),
      el('line', {
        x1: r1(x),
        y1: r1(drop + h / 2),
        x2: r1(x),
        y2: r1(drop + h / 2 + 14),
        stroke: colour,
        'stroke-width': 2,
      }),
    )
  }

  return [el('g', {}, out)]
}

/**
 * A row of lit diyas along the ground.
 *
 * @param {DrawingContext} context The drawing context.
 * @returns {Array<object>} Lamps and flames.
 */
function diyas(context) {
  const { palette, shared, width, height } = context
  const out = []
  const count = 9
  const y = height - 38

  for (let index = 0; index < count; index += 1) {
    const x = ((index + 0.5) / count) * width

    out.push(
      el('ellipse', {
        cx: r1(x),
        cy: r1(y - 8),
        rx: 16,
        ry: 14,
        fill: palette.glow,
        'fill-opacity': 0.25,
      }),
      el('path', {
        d: `M ${r1(x - 12)} ${r1(y - 4)} Q ${r1(x)} ${r1(y + 10)} ${r1(x + 12)} ${r1(y - 4)} Z`,
        fill: shared.diyaClay,
      }),
      el('path', {
        d: `M ${r1(x)} ${r1(y - 18)} C ${r1(x + 4)} ${r1(y - 11)} ${r1(x + 3)} ${r1(y - 5)} ${r1(x)} ${r1(y - 5)} C ${r1(x - 3)} ${r1(y - 5)} ${r1(x - 4)} ${r1(y - 11)} ${r1(x)} ${r1(y - 18)} Z`,
        fill: shared.flame,
      }),
    )
  }

  return [el('g', {}, out)]
}

/**
 * Which picture a category gets.
 *
 * @param {string|undefined} category An `EVENT_CATEGORIES` value.
 * @returns {'circle'|'sticks'|'mandala'} The motif.
 */
export function motifFor(category) {
  if (category === 'GARBA_DANDIYA' || category === 'CLASSICAL_DANCE') return 'circle'
  if (category === 'WORKSHOP' || category === 'SPORTS') return 'sticks'

  return 'mandala'
}

/**
 * A plain-language description of the picture, for its accessible name.
 *
 * @param {string|undefined} category An `EVENT_CATEGORIES` value.
 * @returns {string} What the illustration shows.
 */
export function describePoster(category) {
  const motif = motifFor(category)

  if (motif === 'circle')
    return 'Illustration of garba dancers circling a lit lamp under festival lights'
  if (motif === 'sticks') return 'Illustration of crossed dandiya sticks over a mandala'

  return 'Illustration of a festival mandala under a toran of bunting'
}

/**
 * The drawing for an event.
 *
 * @param {object} options What to draw.
 * @param {string} options.seed The event's slug (or any stable string).
 * @param {string} [options.category] Its category.
 * @param {'card'|'hero'} [options.variant] A hero draws a fuller scene.
 * @param {string} [options.idPrefix] Prefix for gradient ids, unique per page.
 * @returns {{viewBox: string, palette: string, children: Array<object>}} The tree's root content.
 */
export function posterArt(options) {
  const { seed, category, variant = 'card', idPrefix = 'poster' } = options
  const hash = hashString(`${seed}`)
  const random = seededRandom(hash)
  const palette = PALETTES.schemes[hash % PALETTES.schemes.length]
  const { width, height } = POSTER_VIEWBOX
  const id = `${idPrefix}-${hash.toString(36)}`
  const motif = motifFor(category)
  const context = {
    random,
    palette,
    shared: PALETTES.shared,
    id,
    width,
    height,
    hero: variant === 'hero',
    glowY: height * 0.62,
  }
  const children = [...sky(context)]

  if (motif === 'mandala') {
    children.push(
      ...lanterns(context),
      ...mandala(context, width / 2, height * 0.55, 150),
      ...toran(context),
      ...diyas(context),
    )
  } else {
    children.push(...stringLights(context))
    children.push(...(motif === 'circle' ? garbaCircle(context) : dandiyaSticks(context)))
  }

  children.push(...mirrorBand(context))

  return {
    viewBox: `0 0 ${width} ${height}`,
    palette: palette.name,
    children,
  }
}

/**
 * Escape a value for an XML attribute.
 *
 * @param {string|number} value An attribute value.
 * @returns {string} Safe to place between double quotes.
 */
function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/**
 * Write one node, and its children, as SVG markup.
 *
 * @param {{tag: string, attrs: Record<string, string|number>, children: Array<object>}} node A node.
 * @returns {string} Its markup.
 */
function nodeToString(node) {
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')

  if (node.children.length === 0) return `<${node.tag}${attrs}/>`

  return `<${node.tag}${attrs}>${node.children.map(nodeToString).join('')}</${node.tag}>`
}

/**
 * A standalone SVG file of an event's poster.
 *
 * @param {object} options As {@link posterArt}, plus an accessible title.
 * @param {string} options.title Written into `<title>`.
 * @returns {string} A complete SVG document.
 */
export function toSvgString(options) {
  const { title, ...drawing } = options
  const art = posterArt(drawing)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.viewBox}" role="img">`,
    `<title>${escapeAttribute(title)}</title>`,
    art.children.map(nodeToString).join(''),
    '</svg>',
  ].join('')
}
