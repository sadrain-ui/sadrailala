# SKILL-25: ADVERSARIAL AUDIT — MULTI-AGENT DEBATE PATTERN
## SOURCE: Skytliang/Multi-Agents-Debate + AdieLaine/multi-agent-reasoning + mindstudio.ai/MAD
## CATEGORY: META — Cursor Thinking Protocol (The "100-Developer" Audit)

## [STRICT_RULES]
- NEVER ship Legion code without running at least 2 adversarial roles: ATTACKER vs DEFENDER
- ATTACKER role MUST specifically target: reentrancy, MEV front-run, race conditions, integer overflow, oracle manipulation
- DEFENDER role MUST provide counter-evidence with specific line references, not generic rebuttals
- Consensus is reached ONLY when ATTACKER cannot find a new attack vector in 3 consecutive rounds
- NEVER let the same AI perspective validate itself — cross-validate across distinct reasoning frames
- Each debate round MUST output: `[VULNERABILITY FOUND] | [FALSE POSITIVE] | [NEEDS MORE EVIDENCE]`
- If ATTACKER finds Critical severity: STOP, flag to human — NEVER auto-merge Critical findings
- Debate personas MUST be distinct: SecurityAuditor, GasMinimizerEngineer, MEVResearcher, ProtocolDesigner
- Apply this pattern to EVERY new Legion module before it touches funds or live mempool

## [MENTAL_MODEL]
- MAD (Multi-Agent Debate): Multiple AIs argue opposing positions → truth emerges from conflict
- Round 1 — Independent Analysis: Each agent gives its position WITHOUT seeing others' views
- Round 2 — Debate Pass: Each agent reads all others' positions, revises or defends with evidence
- Round 3 — Synthesis: Moderator agent finds consensus, flags unresolved disagreements
- Why it works: One AI commits to wrong answer confidently; adversarial AI catches the flaw
- Legion use: Cursor plays multiple roles in sequence to catch bugs it would miss in single-pass review

## [REAL_API — Debate Protocol for Cursor]
```
### LEGION ADVERSARIAL AUDIT PROTOCOL

**TRIGGER:** Before committing any new strategy/contract/module to Legion Engine.

**STEP 1 — Spawn Personas (Cursor runs these in sequence):**

[PERSONA: SecurityAuditor]
SystemPrompt: "You are a white-hat hacker specializing in DeFi exploits.
 Your ONLY job is to find vulnerabilities. Be adversarial. Assume the code is broken.
 Focus on: reentrancy, access control, oracle manipulation, flash loan attacks, integer overflow/underflow."
Task: "Audit this Legion module: {CODE}. List every vulnerability with severity: Critical/High/Medium/Low."

[PERSONA: MEVResearcher]
SystemPrompt: "You are a searcher who profits by front-running, sandwiching, and back-running transactions.
 Find every way this code can be exploited from the mempool."
Task: "How would you attack this module as a MEV bot? List specific attack vectors."

[PERSONA: GasEngineer]
SystemPrompt: "You obsess over gas costs. Every wasted opcode is a failure.
 Find every unnecessary SLOAD, redundant computation, and suboptimal storage pattern."
Task: "Profile the gas inefficiencies in this code. Estimate savings for each fix."

[PERSONA: ProtocolDefender]
SystemPrompt: "You are the original engineer who wrote this code. Defend it.
 For each attack found, either prove it is NOT exploitable (with specific reasoning) or concede it is valid."
Task: "For each finding above, respond: [VALID ATTACK] or [FALSE POSITIVE: reason]."

**STEP 2 — Debate Round (Cursor plays Attacker vs Defender):**

[ATTACKER reads DEFENDER response]
"Given the defender's counter-arguments, which attacks do I still maintain? Provide new evidence."
→ Output: Maintained attacks with stronger evidence OR withdrawn false positives

[DEFENDER reads ATTACKER response]
"The attacker has refined their position. Can I still defend? Or must I concede?"
→ Output: Conceded vulnerabilities (add to fix list) OR strengthened defense

**STEP 3 — Consensus (Moderator):**

[MODERATOR]
"Summarize unresolved disputes. Output:
- CONFIRMED BUGS: [list with fix required]
- FALSE POSITIVES: [list with reason]
- NEEDS HUMAN REVIEW: [list with why]"
```

## [REAL_API — GPT-Researcher Deep Scan Pattern]
```python
# Use when Legion needs deep research on a specific protocol or attack vector
from gpt_researcher import GPTResearcher

# Research known attacks on a protocol Legion is integrating with
researcher = GPTResearcher(
    query="Known exploits and vulnerabilities in Uniswap V4 hook contracts 2024-2026"
)
await researcher.conduct_research()
report = await researcher.write_report()
# Feed report into SecurityAuditor persona above for contextual audit

# Multi-agent research for complex topics
researcher_multi = GPTResearcher(
    query="MEV sandwich attack patterns targeting new DeFi protocols"
)
# Returns 5-6 page report with citations, tree-depth exploration
```

## [REAL_API — PR-Agent Code Review Integration]
```bash
# Trigger PR-Agent on Legion PRs for automated expert review
# In GitHub PR comments:
@CodiumAI-Agent /review          # Full code review with security focus
@CodiumAI-Agent /improve         # Suggests specific code improvements
@CodiumAI-Agent /describe        # Generates PR summary for audit trail
@CodiumAI-Agent /ask Is this contract vulnerable to reentrancy given the external call on line 47?

# CLI usage for local Legion development:
python -m pr_agent.cli --pr_url <PR_URL> review
python -m pr_agent.cli --pr_url <PR_URL> improve

# Configure in .pr_agent.toml for Legion-specific rules:
# [review]
# require_security_review = true
# focus_on = ["reentrancy", "access_control", "MEV", "integer_overflow"]
```

## [LEGION USE CASES]
- Pre-merge gate: Run Adversarial Audit on EVERY new strategy module — block merge if Critical found
- New protocol integration: Run GPT-Researcher to pull known exploits before Legion integrates
- Automated PR review: PR-Agent /review on all Legion contract changes in CI/CD pipeline
- Incident post-mortem: Replay debate with ATTACKER = known exploit, find if Legion was vulnerable
- Cursor meta-prompt: When writing new Legion code, Cursor MUST run SecurityAuditor persona internally
- 100-Developer simulation: Ask Cursor to generate N different attack perspectives on a single function
