# SKILL-30: CREDIT SHIELD — TOKEN COMPRESSION SYSTEM
## SOURCES:
## - mksglu/context-mode (98% context saving via sandbox + script-generator)
## - JuliusBrussee/caveman (45-87% output token reduction via caveman speak)
## - yuki-20/CornMCP (60-87% token saving via MCP vectorized codebase access)
## CATEGORY: META — Credit Preservation / Token Efficiency

---

## [THE CORE PROBLEM THIS SKILL SOLVES]

Bina is skill ke:
- Cursor 50 files padhta hai ek simple sawal ke liye → 700KB context waste
- Verbose responses likhta hai → 3x zyada output tokens
- Har session mein saari skills fresh load karti hain → context bhara rehta hai
- Raw data context mein dump hota hai → 30 min session 3 hrs mein badal sakta tha

Is skill ke baad:
- Script likhta hai jo sirf result deta hai → 47x fewer tokens
- Terse, surgical responses → 75% output token savings
- Skills MCP cloud memory mein → active context mein sirf kaam ki cheez
- Sandbox: raw data kabhi context mein enter nahi karta

---

## [STRICT_RULES — PERMANENT CURSOR BEHAVIOR]

### RULE SET A: THINK IN CODE, NOT IN READ (Context-Mode Pattern)
- NEVER read multiple files to answer a question — WRITE A SCRIPT that answers it
- NEVER dump raw logs, snapshots, or file contents into context
- ALWAYS prefer `ctx_execute` (script) over Read() — 47 reads = 700KB vs 1 script = 3.6KB
- When output > 5KB: apply intent-driven filtering — return only the answer, not the data
- For file analysis: write script that processes file and console.log()s ONLY the result
- DATA stays outside context. CONCLUSIONS enter context.

### RULE SET B: CAVEMAN COMPRESSION (Output Token Rules)
- DEFAULT mode: Full Caveman — drop articles, filler, pleasantries
- Pattern: [thing] [action] [reason]. [next step]. Nothing more.
- BANNED phrases: "In order to", "It's important to note", "As you can see", "Please note that", "I'd be happy to", "Certainly!", "Great question!"
- Code/URLs/paths: NEVER compress — technical precision untouched
- Commit messages: ≤50 chars. Example: `fix: null guard on executor wallet`
- PR comments: one line. Example: `L42: bug: user null. Add guard.`
- Escalate to Ultra for: quick answers, status checks, confirmations
- ALWAYS give answer first, explanation after (if needed at all)

### RULE SET C: MCP CONTEXT HIERARCHY (CornMCP + Context-Mode)
- Skills (docs/skills/) = CLOUD MEMORY — reference by name, don't re-read full file
- When asked about a skill: return the relevant section only, not the full file
- For codebase questions: use `corn_code_search` (AST+vector) — never full file read
- For cross-session memory: `corn_memory_store` — persist decisions, not files
- Context window priority: 1️⃣ Active task 2️⃣ Relevant skill snippet 3️⃣ Nothing else

### RULE SET D: FIDELITY FIREWALL (Stress-Test Hardening)
- DNA files (Safe, Permit2, MEV bundles, execution engine) = HIGH FIDELITY always — NEVER compress these
- Logs, boilerplate, comments = compress aggressively
- Context Amnesia guard: if unsure about a critical value — RE-READ that specific section, not the full file
- These efficiency rules are BAKED IN — never repeat them in prompts, they are always active

---

## [MENTAL_MODEL]

```
TOKEN COST HIERARCHY (cheapest → most expensive):

1. Script result        →  ~100 tokens   (write script, get answer)
2. Skill snippet        →  ~200 tokens   (reference known skill section)
3. Vector search        →  ~137 tokens   (CornMCP semantic lookup)
4. Single file read     →  ~2,000 tokens (unavoidable sometimes)
5. Multi-file dump      →  ~50,000 tokens (BANNED)
6. Raw log/snapshot     →  ~45,000 tokens (BANNED — use sandbox)

COMPRESSION LEVELS (caveman):
- Lite:  drop filler, keep grammar           → ~30% savings
- Full:  drop articles, fragments (DEFAULT)  → ~65-75% savings
- Ultra: telegraphic, max compression        → ~87% savings

SESSION LIFETIME:
- Without Credit Shield: 315KB context → ~30 min session
- With Credit Shield:    5.4KB context  → ~3 hrs session (98% saving)
```

---

## [REAL_API — CONTEXT-MODE]

```bash
# Install context-mode MCP
npx @mksglu/context-mode

# Add to .mcp.json in legion-engine root:
{
  "mcpServers": {
    "context-mode": {
      "command": "npx",
      "args": ["-y", "@mksglu/context-mode"]
    }
  }
}
```

```typescript
// HOW CURSOR SHOULD USE IT — THE PARADIGM SHIFT

// WRONG (OLD WAY — 700KB context dump):
// Read file1, Read file2, Read file3... "Count functions in each"

// RIGHT (SCRIPT GENERATOR PATTERN — 3.6KB):
// ctx_execute: write a script that counts functions and logs only the count
const script = `
  import { glob } from 'glob'
  const files = await glob('src/**/*.ts')
  const results = await Promise.all(files.map(async f => {
    const code = await fs.readFile(f, 'utf8')
    const count = (code.match(/^\s*(async\s+)?function|=>\s*{/gm) || []).length
    return { file: f, count }
  }))
  console.log(JSON.stringify(results.filter(r => r.count > 0)))
`
// Output: [{"file":"src/executor.ts","count":12},...] → ~200 tokens
// vs reading all files → ~50,000 tokens

// ctx_execute tools:
// ctx_execute(code, lang)         → run script, return only stdout
// ctx_execute_file(path, query)   → process file, 45KB → 155B
// ctx_batch_execute(cmds[])       → multi-commands, 986KB → 62KB
// ctx_stats()                     → see token savings per tool
```

## [REAL_API — CAVEMAN COMPRESSION]

```
# Caveman before/after for Legion responses:

BANNED (69 tokens):
"The reason your React component is re-rendering is because you have an
inline object being passed as a prop. You should use useMemo to memoize."

CORRECT (19 tokens):
"New ref each render. Inline obj prop = re-render. Wrap in `useMemo`."

BANNED (Legion verbose):
"In order to initialize the database connection, we need to make sure
that the configuration object is properly set up with the correct parameters."

CORRECT (Legion terse):
"Init DB. Set config params."

BANNED (commit):
"feat: updated the execution engine to handle cases where the bundle submission fails"

CORRECT (commit):
"fix: bundle retry on submission fail"

# Memory file compression (caveman-compress):
# /caveman:compress docs/skills/00-MASTER-RULES.md
# → compressed version (46-59% fewer tokens) + .original.md backup
# DNA files (04-mev-bundles, 11-safe-multisig): EXEMPT from compression
```

## [REAL_API — CORNMCP SETUP]

```bash
# Clone and build
git clone https://github.com/yuki-20/CornMCP
pnpm install && pnpm build

# Add to Cursor: Settings → Features → MCP → + Add
# Name: corn
# Type: command
# Command: node /path/to/CornMCP/apps/corn-mcp/dist/cli.js
```

```typescript
// CornMCP tools Cursor uses instead of file reads:

// Semantic code search (AST + vector hybrid)
// corn_code_search(query: "bundle submission logic")
// → returns exact functions/snippets, ~137 tokens vs full file read

// 360° symbol context
// corn_code_context(symbol: "sendBundle")
// → definition + callers + call graph, NOT full file

// Cross-session memory
// corn_memory_store(key: "legion-strategy-v2", content: decisionSummary)
// corn_memory_search(query: "last strategy decision")
// → retrieve without re-reading files

// Impact analysis (before refactor)
// corn_code_impact(symbol: "ExecutionEngine")
// → what breaks if I change this, via recursive CTE on call graph

// Token savings stats
// corn_tool_stats() → {file_reads_prevented: 346, tokens_saved: 34600}
```

---

## [IMPLEMENTATION CHECKLIST — ONE-TIME SETUP]

```
[ ] 1. Add context-mode to .mcp.json in legion-engine root
[ ] 2. Add CornMCP to Cursor Settings → Features → MCP
[ ] 3. Bake Caveman rules into Cursor Global Rules (.cursorrules):
        DEFAULT_OUTPUT_MODE=caveman_full
        BANNED_PHRASES=["In order to","It's important","As you can see"]
        READ_THRESHOLD=1 (never read >1 file without script first)
[ ] 4. Run caveman-compress on non-DNA skill files:
        Compress: 01,02,03,06,07,08,09,10 (logs/boilerplate)
        EXEMPT: 04,11,12,13,14,19,21 (critical DNA)
[ ] 5. Verify: ctx_stats() shows >90% context saving vs baseline
```

## [LEGION USE CASES]
- Long session: Credit Shield extends Cursor session from 30min → 3hrs on same context budget
- Codebase analysis: "How many bundles submitted this week?" → script, not 50 file reads
- Strategy research: corn_code_search finds relevant code in 137 tokens, not 50,000
- Status updates: caveman ultra → "Skill 30 done. 31 skills total. Session: 2hrs left."
- Memory: corn_memory_store saves Legion decisions cross-session — no re-reading needed
- Cost tracking: ctx_stats() + corn_tool_stats() = exact token spend visibility
