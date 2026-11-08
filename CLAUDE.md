# CLAUDE.md

The project contract for agents is **[AGENTS.md](AGENTS.md)**: commands, layout, the rules that
must not be broken, and what needs the owner's approval. Read it first; it overrides any older
notes in this repository.

Deeper context: [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md),
[DECISIONS.md](DECISIONS.md), [PLAYBOOK.md](PLAYBOOK.md), [TESTING.md](TESTING.md),
[ROADMAP.md](ROADMAP.md). Historical audits (`CODEBASE_REVIEW.md`, `AUDIT_REPORT.md`,
`IMPLEMENTATION_PLAN.md`) describe earlier states of the code.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
