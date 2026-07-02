# Extreme Learning Machines in n-dx — A Plain-Language Evaluation

*A readable companion to the technical reference (`elm-opportunity-evaluation.md`). This one is for thinking and deciding, not for looking up line numbers. It explains what an ELM is, where it could genuinely help n-dx, where it can't, what we'd do now versus later, and how we keep any of it from breaking things.*

---

## The one-minute version

We looked at whether a tiny, cheap, local machine-learning model — an "Extreme Learning Machine," or ELM — could save us money and time by handling some of the small decisions we currently pay a large language model (LLM) to make.

The honest answer has two parts:

1. **If we only look at what we already do, there's almost nothing worth changing.** The big LLM cost in n-dx is the autonomous agent (hench) *reasoning and writing code* — and no small model can do that. Most of the little decisions (what language is this file? what folder does it belong to?) are already handled for free by simple rules. So swapping an ELM in for an existing LLM call saves us very little.

2. **The real opportunity is in things we don't do yet.** The most promising idea is to give hench a "map" of the codebase before it starts a task, so it wastes fewer expensive steps rediscovering things our analysis tool (sourcevision) already knows. That map-building is where a small model earns its keep — and it sets up a longer-term loop where the agent gets smarter every time it works.

Everything we'd build is a **shortcut placed in front of the current behavior, with an off switch, turned off by default.** If it ever underperforms, we delete it and we're exactly where we started. Nothing we propose can break what works today.

---

## What an ELM actually is (no math)

Think of the difference between a **reflex** and **deliberation**.

An LLM is deliberation. You give it a paragraph, it "thinks," and it can write, reason, and handle things it's never seen. That's powerful, but every call takes real time (hundreds of milliseconds to seconds) and costs real money (you pay per word in and out).

An ELM is a reflex. It's a very small model that, once shown enough examples, answers instantly and for free (it runs on your own CPU, no API, no tokens). The trick that makes it "extreme" is that it barely trains at all — most of its internals are frozen at random and never adjusted, and only a thin final layer is fitted, in a single fast mathematical step. That means:

- It trains in **milliseconds**, on your laptop, with no special hardware.
- It's **deterministic**: same input, same answer, forever. No surprises, no drift between versions.
- It has **no understanding of language on its own** — you have to hand it numbers, so text has to be turned into features first (which words appear, how files connect, etc.).
- It's **only as good as the examples you show it.** It learns by imitation. No examples, no ELM.

A useful mental image: an ELM is a **junior assistant who's memorized a good cheat sheet.** Fast and cheap on the exact kind of question it's been drilled on — and useless outside it. So we only use it for narrow, repetitive questions, and we always keep the "senior" (the LLM) available for when the assistant isn't sure.

## The four questions that decide if an ELM fits

Before considering any task for an ELM, it has to be mostly "yes" on all four:

1. **Is the answer small and closed?** (Pick one of a few options, rank a list, score something — *not* write an essay or reason through a plan.)
2. **Does it happen a lot?** (Tiny savings only matter if they repeat.)
3. **Is a wrong answer harmless?** (Because we'll catch mistakes with a fallback — so a confident-but-wrong reflex can't hurt us.)
4. **Do we have examples to learn from?** (This is usually the hard one, and it's where most ideas die.)

If any answer is "no," it's not an ELM job. We tried hard *not* to force-fit.

## The golden rule that makes all of this safe

Every idea in this document obeys one rule, no exceptions:

> **The ELM is a shortcut placed *in front of* the real work, never a replacement for it. It ships turned off. When it's unsure, it steps aside and the original behavior runs, unchanged. If we ever delete it, the system is byte-for-byte what it is today.**

This is why we can experiment freely. There's no version of this where we "break the working thing to try the new thing." The new thing is always optional, additive, and reversible.

---

## What we actually found in n-dx today

### Where the money really goes

The expensive part of n-dx is **hench, the autonomous agent, thinking**. It reads code, reasons about a task, writes changes, and loops — sometimes dozens of times per task, with the conversation growing each turn. That's open-ended intelligence. No small model can stand in for it, so we leave it completely alone.

(Good news buried in the data: this loop is already heavily **cached**, so we're not paying full price for it. One real run reused over five million tokens from cache while only paying for about a thousand. The obvious cost lever is already being pulled.)

### Most of the "small decisions" are already free

You might expect n-dx to spend LLM calls on things like "what kind of file is this?" or "which task is next?" It mostly doesn't. Those are handled by **plain rules** — fast, free, and already written. An ELM there wouldn't save a cent; at best it might be slightly more accurate. That's a "nice to have," not a reason to build.

### We're not saving our homework (yet)

Here's the single most important finding. To teach an ELM by imitation, you need **examples** — records of "here was the situation, here was the good answer." Right now, n-dx records how *many* tokens each run used, but it **throws away the actual prompts and answers.** So today there's no ready pile of examples to learn from.

**But** — and this is the exciting part — there are **three places where good examples either already exist or are almost free to start collecting:**

- **What files the agent actually opened.** Every hench run already records which files it read while working. If we suggest a set of files and then watch which ones it actually uses, that's a stream of "good answer" labels, generated for free, just by the agent doing its job.
- **Human corrections to file categories.** Our analysis tool lets a person override how a file is classified, and those overrides are saved. Those are hand-graded examples, sitting on disk.
- **Which suggestions people accepted.** When our tool proposes improvements, it records which ones humans kept and which they dismissed. That's a labeled "was this worth surfacing?" dataset — around 200 KB of it — already there.

These three are the difference between "interesting idea, no data" and "we could actually try this." Everything we recommend building is anchored to one of them.

---

## The best opportunity: give hench a map before it starts

### The problem, in plain terms

When hench picks up a task today, we hand it a note that says, essentially: *"Here's the task title, the description, what it depends on, and recent history."* That's it. **We tell it nothing about the codebase itself** — not which files are relevant, not how they connect, not which areas are fragile.

Meanwhile, we have a whole separate tool, sourcevision, that has *already mapped the entire codebase*: 1,370 files, how they import each other (3,000+ connections), which "neighborhoods" (zones) they form, and known trouble spots. **hench never looks at any of it.** It just starts opening files and figuring the structure out from scratch — and every one of those exploratory steps is an expensive LLM turn.

It's like sending a contractor into a building to fix a pipe, but withholding the blueprints you already have in a drawer. They'll find the pipe eventually — by wandering — and you pay for the wandering.

### The idea

Before hench starts, **pick the handful of files and known issues most relevant to this specific task, and put them in the note.** A better-informed agent explores less, which means fewer expensive turns, which means real savings — not on the little decision itself, but on the big loop it makes shorter.

### Why this is a two-step story (and where the ELM comes in)

Choosing "the files most relevant to this task" is a **matching** problem, and at the very start we have no examples of what "relevant" looks like. So we do it in the honest order:

- **Step one — no machine learning at all.** Use what we already know for free: if the task mentions a file or an area, pull its immediate connections and neighbors from the map, and rank the rest by simple word-overlap with the task description. This is cheap, instant, runs entirely inside the existing program, and needs no Python and no training. It ships first and delivers most of the value.
- **Step two — start watching.** As hench works, quietly note which of our suggested files it actually opened. That's us collecting examples, for free, without changing anything the agent does.
- **Step three — add the ELM, once we've watched enough.** Now we have examples of "files we suggested that turned out to matter." Train a small ELM to *re-order* our suggestions so the genuinely useful files rise to the top. It only reshuffles a list we already trust — it can't remove the agent's freedom to look anywhere — so even a bad reshuffle is harmless.

This ordering matters: we get value on day one from plain retrieval, and we only reach for the ELM at the exact point where it's justified and we finally have data to feed it.

### How we'd know it's working

We set the bar up front: with the feature on, hench should use **at least 15% fewer expensive steps (or tokens) to finish the same tasks, with no drop in success.** We can measure this directly, because run records already track tokens, steps, and outcomes. If it doesn't clear that bar, we delete it — no harm done. "It didn't pay off, so we removed it" is a perfectly good result.

---

## Two more places worth a look, inside sourcevision

### 1. Ranking which findings are worth your attention (strong — the data's already there)

sourcevision produces a list of observations and suggestions about the codebase. Today they're ordered by fixed rules. But we already record **which suggestions humans accepted and which they dismissed** — real feedback. A small model could learn from that history to float the suggestions you're actually likely to act on to the top, and quietly demote the noise. Because the examples already exist on disk, this is arguably the **fastest** idea to try, and it makes everything downstream (turning findings into tasks) less noisy.

### 2. Guessing file categories (clean fit, small prize)

sourcevision sorts files into types (component, utility, route handler, and so on). Simple rules handle most of it; for the leftovers, it currently asks the LLM. A small model could take a first crack at those leftovers using the file's name and connections, only bothering the LLM when it's unsure. It's a *tidy* fit — the examples exist (from the rules and from human overrides) — but the savings are small because the LLM is already rarely involved here. So we file this one under **"a good, low-risk place to learn how to build an ELM in our codebase,"** not "a big win." It doubles as a practice run for the model we'd use in step three above.

---

## The longer game: an agent that teaches the analysis tool

Here's where "now" turns into "going forward."

Put the pieces together and a loop appears:

1. hench reads sourcevision's map to work smarter (the main idea above).
2. While working, hench naturally produces feedback — which files mattered, which suggestions were real, how a file actually behaves in practice.
3. That feedback trains the small models, in milliseconds, continuously.
4. The improved models give hench a better map *and* make sourcevision's findings sharper.
5. Which makes the next run smarter still.

In other words, **the agent's everyday work becomes the fuel that keeps the whole system learning** — no separate labeling project, no manual upkeep. This is the genuinely exciting long-term shape, and it's only possible *because* small models retrain so cheaply.

**The one firm rule here:** the agent's learned opinions must live in a **separate, additive layer** — never written over sourcevision's core analysis. That core is supposed to be perfectly reproducible from the code itself, and two processes writing to it at once is already known to be unsafe. So "the agent adds to the analysis" always means "the agent contributes notes *alongside* the analysis, which we can throw away anytime," never "the agent edits the analysis." There's already a proven pattern for exactly this (human overrides that survive re-analysis), so we're extending something that works, not inventing a risky new thing.

---

## What we are recommending *against* (being honest)

Not everything that looks like a fit is worth doing:

- **Speeding up decisions that are already free.** Several classification and ranking steps already run on instant rules. An ELM might be marginally more accurate, but there's no cost or speed to reclaim, so it's not worth the added complexity unless quality specifically becomes a complaint.
- **Forcing a "semantic cache."** The idea of "have we answered a near-identical request before? reuse it" is real and potentially valuable — but that's a *search* technique (comparing meanings), not an ELM. If we pursue it, we'd use the right tool, and we'd track it separately.
- **Anything without examples.** A few tempting spots (tuning which task comes next, re-judging issue severity) fail the "do we have examples?" test, or the examples are too tangled to trust. We leave those alone until that changes.

Recommending "do nothing" in these cases isn't a cop-out — it's the correct call, and it keeps our effort pointed at the few ideas that actually pay.

---

## Now versus later, at a glance

**Do now (this exploration branch):**
- Build the "map for hench" using plain retrieval (no ML), turned off by default, and start quietly collecting examples of which files the agent uses. This delivers value immediately and seeds everything else.

**Do soon (fast follow):**
- Try the "rank findings by what people actually accept" model — the examples already exist, so it's the quickest thing to prove out.

**Do once we've collected enough examples:**
- Add the small model that re-orders hench's file suggestions.
- Optionally build the file-category model as a low-stakes way to nail down our model-building approach.

**Design now, build after the basics work:**
- The self-improving loop where hench's work continuously teaches the models — powerful, but it depends on the earlier pieces existing first.

**Explicitly not now:**
- Speeding up already-free decisions, the semantic cache (different tool), and anything we can't yet supply examples for.

---

## The risks, and how each is handled

- **"What if the model is wrong?"** It can only ever suggest or reorder — never decide or remove options. The agent and the LLM always have the final say. A wrong guess costs nothing.
- **"What if it breaks something?"** It can't. Everything is off by default and deletable. Remove it and the system is exactly as it is today.
- **"Our codebase is JavaScript; ELM tooling is Python."** We avoid that mismatch entirely for the first steps — the retrieval and even the small model can run inside our existing program with no new language or service. We'd only consider a separate Python helper if it clearly proves worthwhile on a real test, never by default.
- **"Will it corrupt our analysis data?"** No. Learned opinions live in a throwaway layer beside the real analysis, never on top of it.
- **"Will results drift over time?"** No — these models are deterministic, and because they retrain in milliseconds we can refresh them on a schedule as the codebase changes.

---

## Bottom line

There's no quick "swap an LLM call for a cheap model and pocket the savings" win hiding in n-dx — the expensive work is genuine intelligence, and the cheap work is already free. **The value is in building something new:** giving hench the map it's currently missing, so it wastes fewer expensive steps, and letting the agent's own work quietly teach a set of tiny, free, instant models that keep the whole system getting sharper.

We start with the plain, no-machine-learning version that helps immediately and collects the examples everything else needs. We only add small models where we've earned the right to — where the examples exist and a mistake is harmless. And at every step there's an off switch, so the worst realistic outcome is simply "we tried it, it didn't pay, we removed it, nothing lost."

*For the exact call sites, data counts, schemas, and file references behind every claim here, see the technical companion: `elm-opportunity-evaluation.md`.*

---

## Mini-glossary

- **LLM (Large Language Model):** the big, smart, general model we call over the internet. Powerful, but slow-ish and paid per word.
- **ELM (Extreme Learning Machine):** a tiny model that runs locally, answers instantly and for free, learns by imitation from examples, and only works on narrow, repetitive questions.
- **Token:** roughly a word-piece; what LLM usage is measured and billed in.
- **hench:** n-dx's autonomous agent that actually does coding tasks.
- **sourcevision:** n-dx's tool that analyzes and maps the codebase.
- **Retrieval:** picking the most relevant items from a pile by comparing them to a query — a search technique, distinct from an ELM.
- **Label / example:** a recorded "situation → good answer" pair that a small model learns from.
- **Fallback:** the original behavior we drop back to whenever the shortcut isn't confident.
