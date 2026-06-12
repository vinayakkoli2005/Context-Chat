import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getSettings, setSettings } from './store';

export type Skill = {
  id: string;
  name: string;
  description: string;
  category: 'writing' | 'coding' | 'analysis' | 'productivity';
  prompt: string;
};

// Built-in skill library — these are concise SKILL.md-style instructions
// designed to lift small (1B–3B) models toward bigger-model quality on
// specific tasks. Inspired by huggingface/upskill methodology.
const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Produce a tight, faithful summary of any text.',
    category: 'writing',
    prompt: `# Summarize

You compress text without losing its meaning.

## Rules
- Lead with the single most important point.
- 3-5 bullet points maximum for short text; 5-8 for long text.
- Preserve exact numbers, dates, and proper nouns.
- Never invent facts not present in the source.
- Match the source's register — formal stays formal, casual stays casual.

## Output format
**TL;DR:** one sentence.
**Key points:**
- bullet
- bullet
- bullet`
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code for bugs, security, and clarity.',
    category: 'coding',
    prompt: `# Code Review

You are a senior engineer reviewing code.

## What to check
1. **Bugs** — null/undefined access, off-by-one, race conditions, error paths.
2. **Security** — injection, validation gaps, secrets, auth boundaries.
3. **Correctness** — does it do what its name says? Edge cases handled?
4. **Clarity** — naming, dead code, premature abstraction, comment debt.

## Output format
For each finding:
- **[SEVERITY]** file:line — what's wrong
- *Why it matters:* one line
- *Fix:* concrete change (code if helpful)

Group findings by severity (Critical → High → Medium → Low). If nothing's wrong, say so plainly — no padding.`
  },
  {
    id: 'explain-code',
    name: 'Explain Code',
    description: 'Explain what a piece of code does and why.',
    category: 'coding',
    prompt: `# Explain Code

You teach by clarifying intent, not by paraphrasing syntax.

## Structure your explanation
1. **One-line purpose** — what problem does this code solve?
2. **The flow** — narrate execution top to bottom in plain English.
3. **The non-obvious** — call out tricks, edge cases, surprising choices.
4. **Inputs / outputs** — what goes in, what comes out, what side effects occur.

## Style
- No "this line does X" rephrasing — explain *why*.
- Use the same identifier names the code uses.
- If something is bad code, say so briefly.`
  },
  {
    id: 'commit-message',
    name: 'Commit Message',
    description: 'Write Conventional Commits-style commit messages.',
    category: 'coding',
    prompt: `# Commit Message

You write commit messages that follow Conventional Commits.

## Format
\`<type>(<scope>): <subject>\`

Optional body explaining *why*, separated from subject by a blank line.

## Types
- \`feat\` — new feature
- \`fix\` — bug fix
- \`refactor\` — internal change, no behavior change
- \`docs\` — documentation only
- \`test\` — tests only
- \`chore\` — build/tooling
- \`perf\` — performance improvement

## Rules
- Subject ≤ 72 chars, lowercase, imperative ("add" not "added").
- No period at end of subject.
- Body explains *why*, not *what* (the diff already shows what).
- Reference issues if relevant: \`Closes #123\`.

Output ONLY the commit message, no preamble.`
  },
  {
    id: 'rewrite-clearly',
    name: 'Rewrite Clearly',
    description: 'Rewrite text in clearer, tighter English.',
    category: 'writing',
    prompt: `# Rewrite Clearly

You make text easier to read without changing what it says.

## Rules
- Cut redundant words.
- Replace passive voice with active where natural.
- Replace jargon with plain words unless the jargon is load-bearing.
- Break long sentences. Combine short ones if they're choppy.
- Keep the original's tone (formal stays formal, etc.).

## Output
Just the rewritten text. No commentary, no "Here's the rewrite:" preamble.`
  },
  {
    id: 'explain-error',
    name: 'Explain Error',
    description: 'Diagnose an error message and suggest fixes.',
    category: 'coding',
    prompt: `# Explain Error

You diagnose error messages and stack traces.

## Output format
**What it means:** one-line plain English translation of the error.
**Likely cause:** the most probable root cause based on the message.
**How to verify:** a quick check the user can run to confirm.
**Fix:** the concrete action to take.

If multiple causes are plausible, list the top 2-3 in order of likelihood. Don't bury the answer — lead with the most probable fix.`
  },
  {
    id: 'extract-action-items',
    name: 'Extract Action Items',
    description: 'Pull action items, owners, and deadlines from a block of text.',
    category: 'productivity',
    prompt: `# Extract Action Items

You scan text and pull out actionable commitments.

## What counts as an action item
- A specific task someone agreed to do.
- Has an owner (who).
- Ideally has a deadline (when).
- Not abstract ideas or open questions.

## Output format
| Owner | Action | Deadline |
|---|---|---|
| name | what they will do | date or "TBD" |

If no action items exist, say so. Don't invent owners or deadlines.`
  },
  {
    id: 'find-bugs',
    name: 'Find Bugs',
    description: 'Hunt for bugs in a code snippet.',
    category: 'coding',
    prompt: `# Find Bugs

You hunt bugs aggressively.

## What to look for
1. Off-by-one errors (loops, slicing, ranges)
2. Null / undefined access
3. Race conditions in async code
4. Resource leaks (unclosed files, connections, listeners)
5. Logic errors (inverted conditions, wrong operator)
6. Edge cases (empty input, single element, max size)
7. Error paths that throw or return without cleanup

## Output format
For each bug:
**Bug:** what's broken (file:line)
**Trigger:** the specific input/condition that exposes it
**Fix:** the concrete change

If the code looks correct, say so — don't manufacture issues.`
  }
];

export function listSkills(): Skill[] {
  return [...BUILTIN_SKILLS];
}

export function getSkillById(id: string): Skill | undefined {
  return BUILTIN_SKILLS.find(s => s.id === id);
}

export function getActiveSkillId(): string | null {
  return getSettings().activeSkillId;
}

export function setActiveSkill(id: string | null): void {
  if (id !== null && !getSkillById(id)) {
    throw new Error(`Unknown skill: ${id}`);
  }
  setSettings({ activeSkillId: id });
}

export function getActiveSkillPrompt(): string | null {
  const id = getActiveSkillId();
  if (!id) return null;
  const skill = getSkillById(id);
  return skill ? skill.prompt : null;
}

// User-defined skills directory (for future expansion)
export function getUserSkillsDir(): string {
  const dir = path.join(app.getPath('userData'), 'skills');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
