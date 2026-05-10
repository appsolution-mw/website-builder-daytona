# Customer Pain Points

## Executive Read

Website Builder Daytona addresses a painful before-state that is bigger than
"building websites is slow." The sharper pain is that modern website work sits
between non-technical intent and production-grade engineering controls.
Marketing, product, founders, agencies, and engineering teams all want faster
web changes, but they do not want an ungoverned AI tool silently rewriting a
real repository.

The customer is not only buying page generation. They are trying to escape a
workflow where every small change becomes a handoff: describe the change, wait
for a developer, create a branch, wire environment variables, run the app,
share a preview, collect visual feedback, debug console errors, review a diff,
open a pull request, and track whether AI/model spend was worth it.

The product's strongest pain-point fit is with customers who already believe AI
can help, but have been burned by one of three things:

- the output looked good in a toy preview but was not usable in their codebase;
- the agent changed files without enough traceability or recovery;
- the process still required a developer to glue together preview, GitHub,
  terminal, logs, environment, and review.

Daytona's real promise is psychological as much as technical: "I can let the
agent work because the work is isolated, visible, interruptible, reviewable,
and handoff-ready."

## Research Basis

This analysis is inferred from the current codebase and product analysis files,
especially the project dashboard, workspace, agent runtime docs, Prisma schema,
worker-pool runtime, GitHub handoff, usage dashboard, agent configuration, and
existing `project-analysis/` reports.

Important repo signals:

- Projects are isolated Docker sandboxes, not static documents.
- Projects can originate from a template or a GitHub repository and branch.
- The workspace combines chat, live preview, files, code editor, terminal,
  preview console, commit history, environment settings, agent configuration,
  model/runtime selection, and pull request creation.
- Agent prompts become durable queued runs with statuses, attempts, events,
  retry, skip, cancellation, and blocked-queue handling.
- Agent work can produce commits, file diffs, and GitHub pull requests.
- Token/cost usage is tracked by project and turn.
- Worker capacity, readiness, heartbeats, HMAC-protected worker calls, broker
  readiness, orphan cleanup, and sandbox lifecycle are first-class concepts.
- Skills, file agents, AGENTS.md behavior, and workflow presets are managed as
  reusable configuration rather than one-off prompt text.

The evidence points to a customer who wants AI-assisted speed, but cannot
accept AI-generated opacity.

## Core Customer Job

The core job-to-be-done:

> When I need a website or web-app change, I want to turn intent into a live,
> inspectable, production-bound code change without waiting on a full engineering
> loop or losing control of the codebase.

Functional job:

- Create or modify a real Next.js project.
- See the result in a running preview.
- Use visual context and screenshots when words are inadequate.
- Inspect and edit files when the agent is close but not quite right.
- Run commands and diagnose issues without leaving the workspace.
- Save work as commits and hand it to GitHub as a pull request.
- Track what the agent did, which model/runtime did it, and what it cost.

Emotional job:

- Feel faster without feeling reckless.
- Feel in control while delegating to an AI agent.
- Avoid the embarrassment of handing engineers a vague request or broken AI
  output.
- Avoid the anxiety of "what did the agent just change?"
- Recover confidence after a failed, stuck, or expensive agent run.

Social job:

- Let a marketer, founder, designer, or client look capable because they can
  initiate meaningful web changes.
- Let an engineer or technical lead look responsible because changes still pass
  through code review and GitHub.
- Let an agency or product team look responsive without sacrificing standards.

## Painful Before-State

### 1. Small Website Changes Become Expensive Queues

The surface-level pain is that simple website requests take too long. The
deeper pain is that "simple" rarely means operationally simple.

A growth lead wants to change a hero, test a pricing block, update onboarding
copy, or polish a mobile layout. In the old workflow, that request becomes a
ticket. The ticket needs clarification, a developer's local setup, a branch, a
preview build, review comments, revisions, and finally a merge. The actual code
change may take twenty minutes; the elapsed time can be days.

Customer psychology:

- "I know exactly what I want, but I cannot safely make it happen myself."
- "Engineering is not blocking me on purpose, but I am still blocked."
- "Every small request makes me feel guilty because I am pulling a developer
  away from higher-priority work."

Daytona addresses this by giving the requestor a live agent workspace while
still preserving code, preview, terminal, commits, and GitHub handoff.

### 2. Prompt-To-Page Tools Create A Dead End

Many customers have tried AI website generators and discovered that the first
output is not the hard part. The hard part is everything after the first output:
using an existing repository, wiring real dependencies, preserving conventions,
debugging behavior, creating a reviewable diff, and getting the change into the
team's normal workflow.

The painful before-state is a beautiful artifact that cannot graduate:

- the generated page is not in the real repo;
- the code is not easy to inspect or fix;
- there is no terminal escape hatch;
- preview behavior differs from the production app;
- changes cannot be reviewed as normal commits;
- the tool stops at "looks nice" instead of "ready for engineering review."

Customer psychology:

- "This demo is impressive, but I do not know how to use it in the actual app."
- "If I give this to engineering, they will probably rebuild it anyway."
- "I do not want another island of generated code."

Daytona's GitHub import, sandboxed runtime, code editor, preview, terminal, and
pull request path speak directly to this dead-end anxiety.

### 3. Handoff Friction Turns Intent Into Lossy Translation

Website work is full of visual and subjective requirements. A stakeholder says
"make this section feel more premium" or "the mobile card spacing feels off."
The developer receives a screenshot, a paragraph, maybe a Figma link, and a
half-remembered conversation. Each handoff loses information.

The painful before-state is not just waiting. It is translation overhead:

- visual feedback has to be converted into textual tickets;
- screenshots are separated from the running app;
- the reviewer cannot easily point the agent at the exact region;
- follow-up revisions require another round of explanation;
- nobody is sure whether the latest preview reflects the latest request.

Customer psychology:

- "I can see the problem, but describing it precisely is exhausting."
- "The thing I meant and the thing that got built keep drifting apart."
- "I do not want to become a CSS spec writer just to ask for a visual fix."

Daytona's image attachments and preview-region capture reduce this translation
tax. They let the customer provide visual context directly inside the agent
loop.

### 4. Preview And Deploy Uncertainty Erodes Trust

A website change is not real until someone can open it and interact with it.
Before Daytona, the preview path is often a patchwork: local dev server, tunnel,
Vercel preview, staging environment, screenshots, or "it works on my machine."
That uncertainty creates friction for every buyer persona.

Pain points:

- marketers cannot confidently review responsive behavior;
- founders cannot show a live iteration to a teammate or client;
- engineers waste time explaining which preview is current;
- browser console errors are invisible to non-developers;
- environment variables or runtime config can make the preview lie.

Customer psychology:

- "I need to see it before I can approve it."
- "A screenshot is not enough."
- "I worry the demo works, but the real app will break."

The workspace's live preview, device frames, preview console, restart controls,
broker readiness gates, and project environment editor all address the same
fear: the customer needs the result to feel real, not simulated.

### 5. AI Code Changes Feel Opaque And Hard To Trust

Customers are increasingly willing to let agents write code, but the blocker is
not only model quality. It is accountability. If an AI agent changes ten files,
the buyer wants to know what changed, why, under which model, and whether it can
be reviewed or reverted.

The painful before-state:

- agent chat output is divorced from source-control history;
- a stakeholder sees a working preview but not the file-level impact;
- engineering sees a diff but not the original intent and model context;
- failed or partial runs leave unclear state;
- there is no clean "unit of work" for review.

Customer psychology:

- "I am not afraid the agent can write code. I am afraid I cannot audit it."
- "If this breaks something, who can explain what happened?"
- "I need to prove this was a controlled change, not a random prompt result."

Daytona's durable run events, per-turn commits, commit metadata, changed-file
history, diff inspection, runtime/model labels, and PR handoff convert agent
activity into reviewable work artifacts.

### 6. Governance Worries Slow Team Adoption

For an individual, AI code generation is exciting. For a team, it raises
questions immediately:

- Who has access to the project?
- Which repository did the agent touch?
- Which runtime and model were used?
- What instructions guided the agent?
- Were environment variables exposed?
- Can the agent run destructive commands?
- What did it cost?
- Can failed work block or corrupt follow-up work?

The painful before-state is not a single missing feature; it is a lack of
organizational control. Teams hesitate because the AI workflow feels like a
personal tool rather than managed production infrastructure.

Customer psychology:

- "I like the speed, but I need a story I can defend to engineering/security."
- "I do not want every person inventing their own prompt stack."
- "I need repeatability before I can roll this out beyond one power user."

Daytona addresses this through workspace/project access, project-specific agent
config, reusable skills and file agents, workflow presets, HMAC-protected worker
control, queue serialization, cancellation, usage records, and isolated
sandboxes. The product does not need to claim "AI is safe"; it can credibly
claim "AI work is bounded and observable."

### 7. Agent Adoption Anxiety Comes From Loss Of Control

The buyer's internal debate is often not "should we use AI?" It is "how much
control do we have to give up to get AI speed?"

Common fears:

- the agent will make a sweeping change when a small fix was requested;
- the agent will keep spending tokens while stuck;
- the agent will edit while a human is also editing;
- a failed run will leave the workspace in an unknown state;
- model choice will become a support burden;
- non-technical users will over-trust the output;
- technical users will reject the tool because it hides too much.

This is why the product's intervention points matter. Abort, retry, skip,
read-only editor locking during agent turns, terminal access, file inspection,
model/runtime selection, status badges, and queue-state UI are not secondary
features. They are trust controls.

Customer psychology:

- "Let me delegate, but let me interrupt."
- "Let me use the agent, but do not trap me inside the agent."
- "Let me choose power, but give me a way back to normal engineering."

### 8. Runtime And Model Choice Creates Both Hope And Confusion

Multi-runtime support solves one customer pain and creates another. It reduces
fear of vendor lock-in and lets teams match tasks to agent capabilities, but it
also introduces a decision burden.

Before-state pain:

- teams argue over Claude Code vs. Codex vs. OpenHands instead of shipping;
- costs, context length, visual capability, and tool behavior vary by provider;
- a model that works for copy tweaks may fail on repo-heavy changes;
- no one knows which configuration should become the team default.

Customer psychology:

- "I want the best agent for the job, but I do not want to become an agent
  operations expert."
- "If the model changes, I do not want our whole workflow to collapse."

Daytona's runtime abstraction, model picker, session runtime state, and
workflow presets address this by making the project the durable center. The
model becomes a selectable worker, not the system of record.

### 9. Cost Uncertainty Makes AI Feel Risky

Agentic coding has an unusual cost profile. A small prompt can lead to a long
run, large context reads, retries, reviewer passes, image inputs, or tool loops.
Customers may like the result but still fear a surprise bill.

Pain points:

- token spend is invisible until after the fact;
- cache write/read behavior is poorly understood;
- long-running agents occupy infrastructure capacity as well as model spend;
- different runtimes report usage differently;
- managers cannot attribute cost to projects or turns.

Customer psychology:

- "I need to know whether this saved money or just moved the cost somewhere
  else."
- "I cannot roll this out if every prompt feels like an open meter."

Daytona's token and cost dashboard, per-project usage, per-turn records,
runtime/model metadata, and worker capacity model are responses to this budget
anxiety.

### 10. Sandbox Operations Are A Hidden Bottleneck

Serious AI web work needs an environment where code can run. That sounds simple
until every project needs ports, containers, broker tokens, preview URLs, worker
capacity, cleanup, health checks, restart behavior, and source import.

Before Daytona, teams often choose between two bad options:

- let every developer or agent run locally, creating inconsistent setup and
  support burden;
- centralize execution, but then build internal infrastructure around sandboxes,
  routing, secrets, queues, and cleanup.

The repo's worker pool, broker readiness, HMAC routes, sandbox tokens,
heartbeat, orphan cleanup, capacity slots, and Hetzner provisioning all point to
this hidden customer pain.

Customer psychology:

- "I want the benefit of a cloud dev environment without operating one myself."
- "I do not want AI agents running against someone's laptop as production
  process."
- "If ten projects are active, I need to know what is running, stuck, idle, or
  wasting money."

For agencies and internal platform teams, this operational pain is especially
sharp. They do not just need a builder; they need a repeatable execution
environment.

## Persona-Specific Pain

### Technical Founder

The founder wants to move faster than a normal engineering roadmap allows, but
does not want to lose code ownership.

Pain:

- has ideas faster than they can implement them;
- needs a real repo, not a disposable artifact;
- wants AI speed with terminal/code escape hatches;
- fears getting trapped in a proprietary builder.

Desired feeling:

- "I can go from idea to running code tonight, and still own the result."

### Growth Or Marketing Lead

The growth lead owns conversion outcomes but depends on engineering for even
small site changes.

Pain:

- campaigns wait on implementation;
- visual feedback is hard to express;
- experiments die in the ticket queue;
- engineers push back on vague requests;
- preview links and screenshots become confusing.

Desired feeling:

- "I can drive changes directly, then hand engineering something concrete
  instead of another vague ticket."

### Agency Operator Or Freelance Developer

The agency wants to produce more client work without letting quality vary by
who wrote the prompt.

Pain:

- repeated client revisions drain margin;
- every client project needs isolated setup;
- AI output must match agency conventions;
- clients need previews, but developers need reviewable commits;
- reusable process lives in someone's head.

Desired feeling:

- "We can standardize our AI workflow across client projects and still review
  every change."

### Engineering Lead

The engineering lead does not want to block business teams, but also does not
want uncontrolled AI changes entering the codebase.

Pain:

- small web requests interrupt deeper engineering work;
- generated code lacks traceability;
- non-technical users may not notice edge-case breakage;
- PRs need reviewable diffs and clean branch context;
- security and environment handling need boundaries.

Desired feeling:

- "The business can move faster without bypassing engineering controls."

### Platform Or Operations Owner

The operator cares about whether the sandbox fleet is reliable, secure, and
economically manageable.

Pain:

- worker capacity can be exhausted;
- orphan containers waste resources;
- long-running agent tasks tie up slots;
- readiness failures create support load;
- secrets and control-plane endpoints need protection.

Desired feeling:

- "I can run this service with visibility into capacity, health, and cleanup."

## Trigger Events

The customer is most likely to seek a product like Daytona after one of these
events:

- a marketing or product team misses a launch because web changes waited in
  engineering queue;
- an AI-generated page impresses stakeholders but cannot be merged into the real
  app;
- a developer spends too much time turning vague visual feedback into CSS
  changes;
- a founder wants to prototype a SaaS UI but refuses to give up code ownership;
- an agency needs to scale client revisions without hiring more developers;
- an engineering lead sees employees using unmanaged AI coding tools against
  company repositories;
- AI usage cost grows without project-level attribution;
- local development setup becomes a blocker for contributors or agents;
- a failed agent run leaves a repo or workspace in unclear state;
- stakeholders argue over which model/runtime to trust.

## Customer Vocabulary To Use

Likely high-signal language:

- "reviewable changes"
- "real repo"
- "live preview"
- "safe sandbox"
- "what changed?"
- "open a PR"
- "agent got stuck"
- "model spend"
- "reuse the same workflow"
- "client revisions"
- "visual feedback"
- "works locally, but..."
- "too many handoffs"
- "I do not want to lose control"
- "we need governance before rollout"
- "not another throwaway generator"

Messaging should avoid making the customer feel foolish for needing controls.
The product should validate their skepticism: they are right to worry about AI
work that cannot be inspected, interrupted, or handed off.

## Pain Hierarchy

The most commercially important pains are:

1. Handoff drag: valuable website changes wait behind engineering queues.
2. Trust gap: AI output is fast but opaque unless converted into inspectable
   code, commits, and PRs.
3. Preview uncertainty: customers cannot approve what they cannot run and see.
4. Governance anxiety: teams need reusable rules, access boundaries, cost
   visibility, and auditability before adoption spreads.
5. Operational burden: isolated AI sandboxes are valuable, but painful to run
   without a managed control plane.

The less important pain is "I need a website generated from a prompt." That is
table stakes and crowded. The more important pain is "I need AI to participate
in our real website production workflow without making the workflow less
trustworthy."

## Strategic Implication

Daytona should not lead with generic website-builder pain. The deeper customer
pain is controlled throughput: teams want more web changes shipped per week
without expanding handoff burden, bypassing engineering, losing code ownership,
or creating unmanaged AI risk.

The strongest promise:

> Turn website change requests into isolated previews, inspectable commits, and
> GitHub-ready pull requests while keeping agent work visible, governed, and
> recoverable.

That promise meets the customer's real before-state: not lack of ideas, and not
even lack of AI tools, but lack of a trustworthy operating layer between an AI
agent and production-bound web code.
