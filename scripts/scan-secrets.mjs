#!/usr/bin/env node
/**
 * Secret scan over tracked files.
 *
 * Scoped to what git tracks, for the same reason the language policy checker is:
 * a secret that is not committed is not in the repository, and a scanner that
 * walks the working tree spends its time on `node_modules` and build output.
 *
 * This is a tripwire, not a guarantee. It catches the shapes that actually get
 * committed by accident — a private key block, a cloud access key, a real value
 * assigned to something named `SECRET` — and it will not catch a credential
 * that looks like ordinary prose. A green run means nothing obvious is
 * committed, not that nothing is.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs [--json]
 */

import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Files that are allowed to contain credential-shaped strings, and why. */
const ALLOWED = new Map([
  [
    '.env.example',
    'Template of variable names with placeholder values, which is its whole purpose.',
  ],
  [
    'docs/development.md',
    'Documents the local development credentials, which are public by design.',
  ],
  ['README.md', 'Quickstart shows the local development connection string.'],
  ['.github/workflows/ci.yml', 'CI-only values for throwaway service containers.'],
  [
    'docs/ADVERSARIAL_REVIEW_FINDINGS.md',
    'Quotes the placeholder secret while describing the finding about it.',
  ],
  [
    'POST_EFDA577_CORRECTIVE_REPORT.md',
    'Quotes the placeholder secret while describing the finding about it.',
  ],
])

/** Extensions never worth scanning: binary, or machine-generated. */
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.pdf',
])

/** Files whose whole job is to be a lockfile. */
const SKIP_FILES = new Set(['pnpm-lock.yaml'])

/**
 * Patterns that indicate a committed credential.
 *
 * Each carries its own rationale, because a scanner nobody understands is a
 * scanner people disable.
 */
const PATTERNS = [
  {
    name: 'private key block',
    // The unambiguous one: nothing legitimate ships a PEM private key.
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: 'AWS access key id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    name: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: 'Stripe live key',
    // Test keys (sk_test_) are deliberately not flagged; live ones are.
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/,
  },
  {
    name: 'assigned secret with a long opaque value',
    // A name that implies a credential, assigned something long enough to be
    // one. Short values and obvious placeholders are excluded below.
    pattern:
      /\b(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY)\b\s*[:=]\s*['"]([^'"\s]{24,})['"]/i,
    /**
     * Ignore values that announce themselves as fake.
     *
     * @param {RegExpMatchArray} match The match.
     * @returns {boolean} True when the value is an obvious placeholder.
     */
    ignore: (match) =>
      /change|example|placeholder|dummy|sample|your|xxx|\.\.\.|test|dev-only|insecure|fake|redacted/i.test(
        match[1],
      ),
  },
]

/**
 * Files git tracks, plus untracked files that are not ignored.
 *
 * @returns {string[]} Repository-relative paths.
 */
function trackedFiles() {
  const stdout = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )

  return stdout.split('\0').filter(Boolean)
}

/**
 * Scan every tracked file.
 *
 * @returns {Promise<{findings: object[], scanned: number}>} Findings and how many files were read.
 */
async function scan() {
  const findings = []
  let scanned = 0

  for (const relative of trackedFiles()) {
    if (SKIP_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue
    if (SKIP_FILES.has(relative)) continue

    let contents
    try {
      contents = await readFile(path.join(repoRoot, relative), 'utf8')
    } catch {
      continue
    }

    scanned += 1

    const lines = contents.split('\n')

    for (const [index, line] of lines.entries()) {
      for (const rule of PATTERNS) {
        const match = line.match(rule.pattern)
        if (!match) continue
        if (rule.ignore?.(match)) continue
        if (ALLOWED.has(relative)) continue

        findings.push({
          file: relative,
          line: index + 1,
          rule: rule.name,
        })
      }
    }
  }

  return { findings, scanned }
}

/**
 * A committed `.env` is a finding on its own, whatever is in it.
 *
 * @returns {string[]} Violations.
 */
function environmentFiles() {
  return trackedFiles().filter(
    (relative) =>
      path.basename(relative) === '.env' || /^\.env\.(?!example)/.test(path.basename(relative)),
  )
}

const asJson = process.argv.includes('--json')

try {
  const { findings, scanned } = await scan()
  const envFiles = environmentFiles()

  for (const relative of envFiles) {
    findings.push({ file: relative, line: 0, rule: 'environment file is tracked' })
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: findings.length === 0, scanned, findings }, null, 2))
  } else if (findings.length === 0) {
    console.log(`Secret scan: OK — ${scanned} tracked files scanned, nothing credential-shaped.`)
  } else {
    console.error(`Secret scan: ${findings.length} finding(s) across ${scanned} files.\n`)
    for (const finding of findings) {
      console.error(`  ✗ ${finding.file}:${finding.line} — ${finding.rule}`)
    }
  }

  process.exit(findings.length === 0 ? 0 : 1)
} catch (error) {
  console.error(`Secret scan failed to run: ${error.message}`)
  process.exit(2)
}
