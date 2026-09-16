# Multi-Asset Allocation Dashboard — Product, UX & Interaction Specification

> **Purpose:** This document is intended to be fed directly to a design/code harness to build the dashboard. It translates the existing `MultiAsset_Allocation_Framework_v2` workbook into a premium, highly interactive investment dashboard with an Altruist-inspired visual language and Apple-like motion.
>
> **Primary principle:** Do **not** recreate Excel in a browser. The workbook is the model/backend. The dashboard is a decision and explanation layer.

---

## 1. Product thesis

The underlying framework is an asset-allocation model with the following conceptual flow:

```text
Market + manual data → Signal Scores → Composite Scores → Vetoes → Tilts → Ideal Allocation
```

The dashboard should make this chain understandable without requiring the user to know how the workbook is structured. It does **not** manage a client's portfolio, recommend products or prescribe transactions.

The product should feel closer to:

- a premium investment-model control surface,
- Altruist-style financial clarity,
- Apple-style interaction/motion,
- progressive disclosure rather than dense terminal-style analytics.

The UX should optimize for these questions, in this order:

1. **What is the current ideal asset allocation based on the latest market data and model inputs?**
2. **Which L1 and L2 sleeves does that allocation contain?**
3. **Which signal scores and composite scores produced those weights?**
4. **Which underlying data points produced each signal score, and how fresh/reliable are they?**
5. **Which rules changed the raw result—neutral anchors, tilt caps, normalization, thresholds or vetoes?**
6. **What allocation would change if an input or parameter changed?**
7. **When was this model state calculated and published?**

Neutral allocation and the previous published allocation are useful comparison overlays. They are **not** the product's primary story and must never displace the current ideal allocation as the first answer.

This hierarchy is more important than mirroring workbook tabs.

---

# 2. Core information architecture

Recommended primary navigation:

```text
Overview
Model
Reviews
```

Suggested expanded structure:

```text
⌂ Overview

◇ Model
   ├─ Data Points
   ├─ Signals & Scores
   ├─ Allocation Logic
   └─ Methodology

◷ Reviews
```

Optionally provide global `⌘K` search.

Do **not** expose client-portfolio or product-implementation navigation. Also do **not** reproduce each workbook tab as a separate top-level page:

```text
Bad:
Asset Classes
Equity Segments
Debt Buckets
Precious Metals
Sector Satellite
```

Those are model groupings and should live as tabs/filters inside **Model Explorer**.

---

# 3. Current model snapshot from workbook

These values are the current output of the supplied allocation model and should be used as the initial demo/default state unless model data is wired dynamically.

## 3.1 L1 allocation — portfolio level

| Asset Class | Neutral | Composite | Veto | Model Allocation | vs Neutral |
|---|---:|---:|---|---:|---:|
| Equity | 55.00% | 50.50 | No | **54.4511%** | -0.5489 pp |
| Debt | 35.00% | 57.50 | No | **35.6190%** | +0.6190 pp |
| Precious Metals | 10.00% | 51.25 | No | **9.9298%** | -0.0702 pp |

Rounded dashboard display:

```text
Equity            54.5%
Debt              35.6%
Precious Metals    9.9%
```

---

## 3.2 L2 equity allocation — weights within Equity

| Equity Segment | Neutral within Equity | Composite | Veto | Final within Equity | vs Neutral |
|---|---:|---:|---|---:|---:|
| Large Cap | 45.00% | 53.50 | No | **46.6127%** | +1.6127 pp |
| Mid Cap | 20.00% | 42.50 | No | **19.3776%** | -0.6224 pp |
| Small Cap | 15.00% | 33.25 | **Yes** | **13.6886%** | -1.3114 pp |
| International | 20.00% | 50.25 | No | **20.3211%** | +0.3211 pp |

The sector satellite is carved from Equity after the core-equity allocation is calculated.

Current sector sleeve deployment = **7.5% of Equity** because one sector qualifies and the framework permits a maximum of two sectors with a 15% total sleeve cap.

---

## 3.3 L2 debt allocation — weights within Debt

| Debt Bucket | Neutral within Debt | Composite | Veto | Final within Debt | vs Neutral |
|---|---:|---:|---|---:|---:|
| Liquid / Short | 40.00% | 54.50 | No | **39.3590%** | -0.6410 pp |
| Corporate / Medium | 35.00% | 55.50 | No | **34.6404%** | -0.3596 pp |
| Gilt / Long | 25.00% | 64.25 | No | **26.0006%** | +1.0006 pp |

---

## 3.4 L2 precious metals allocation — weights within Metals

| Metal | Neutral within Metals | Composite | Veto | Final within Metals | vs Neutral |
|---|---:|---:|---|---:|---:|
| Gold | 75.00% | 51.25 | No | **74.4681%** | -0.5319 pp |
| Silver | 25.00% | 57.00 | No | **25.5319%** | +0.5319 pp |

---

## 3.5 Final portfolio rollup — true portfolio weights

This is the most important L2 dataset for the main allocation component.

| Portfolio Sleeve | Portfolio Weight |
|---|---:|
| Large Cap | **23.4776%** |
| Mid Cap | **9.7600%** |
| Small Cap | **6.8946%** |
| International | **10.2352%** |
| Capital Goods / Infra sector sleeve | **4.0838%** |
| Liquid / Short Debt | **14.0193%** |
| Corporate / Medium Debt | **12.3385%** |
| Gilt / Long Debt | **9.2612%** |
| Gold | **7.3946%** |
| Silver | **2.5353%** |
| **Total** | **100%** |

This is what the L2 view of the hero allocation bar must render.

---

# 4. Signature component: Morphing L1 ↔ L2 Allocation Bar

This is the most important interaction in the entire dashboard.

The allocation bar should feel like **one continuous physical object** that changes depth — not like two separate charts.

## 4.1 L1 state

```text
Allocation                                      Overview ●──── Detail

┌────────────────────────────────────────────────────────────────────┐
│           EQUITY 54.5%            │       DEBT 35.6%      │METALS│
│                                    │                       │ 9.9% │
└────────────────────────────────────────────────────────────────────┘
```

The exact visual proportions must correspond to portfolio weights.

Do not use a donut chart as the primary allocation visualization.

Reasons:

- difficult to compare closely sized segments,
- poor support for hierarchy,
- makes L1 → L2 decomposition harder to understand,
- less natural for morph animation.

A 100%-width horizontal allocation ribbon is preferred.

---

## 4.2 L2 state

Toggling to Detail must **decompose each parent asset-class block in place**.

```text
Allocation                                      Overview ────● Detail

         EQUITY · 54.5%                     DEBT · 35.6%        METALS · 9.9%
┌────────┬──────┬──────┬──────────┬───────┬─────────┬────────┬──────┬──────┬──────┐
│ LARGE  │ MID  │SMALL │  INTL    │SECTOR │ SHORT   │ CORP   │ GILT │ GOLD │SILVER│
│ 23.5%  │ 9.8% │ 6.9% │ 10.2%    │ 4.1%  │ 14.0%   │ 12.3%  │ 9.3% │ 7.4% │ 2.5% │
└────────┴──────┴──────┴──────────┴───────┴─────────┴────────┴──────┴──────┴──────┘
└──────────────── EQUITY ────────────────┘└──────── DEBT ────────┘└── METALS ──┘
```

### Critical requirement

When transitioning from L1 to L2:

- the Equity 54.5% block must **remain spatially anchored**, then split into Large/Mid/Small/International/Sector,
- the Debt block must split into Liquid/Short, Corporate/Medium, Gilt/Long,
- the Metals block must split into Gold and Silver,
- parent groups must remain visually obvious while in L2,
- there should be **no hard chart replacement**, crossfade, or page navigation.

The user should physically understand:

> “These child sleeves are what the parent asset class is made of.”

---

# 5. L1 ↔ L2 control

Avoid a generic `L1 | L2` segmented control as the only UI.

Preferred user-facing language:

```text
Allocation depth

Overview  ●────────○  Detail
```

or

```text
Allocation view
[ Overview ]   [ Detail ]
```

Tooltip / secondary labels:

```text
Overview = L1 · Asset Classes
Detail   = L2 · Allocation Sleeves
```

This preserves model terminology without requiring casual users to understand it.

---

# 6. Apple-style L1 → L2 animation behavior

## 6.1 Motion principle

The motion should communicate structure, not decorate the screen.

The transformation should feel analogous to opening a folder or expanding a nested object in iOS/macOS.

### L1 → L2 sequence

1. User activates `Detail`.
2. Parent text (`EQUITY 54.5%`) subtly moves upward.
3. Parent text scales down into a group label.
4. Internal dividers emerge from inside the existing parent rectangle.
5. Child widths spring toward their exact target proportions.
6. Child labels fade/slide into position after sufficient width exists.
7. Thin parent grouping rail resolves beneath the children.
8. Any veto glyph is introduced only after geometry settles.

### Reverse L2 → L1

The exact inverse should occur:

- labels fade/contract,
- dividers collapse,
- children merge back into their parent geometry,
- parent label returns to center.

Never simply swap components.

---

## 6.2 Timing

Recommended motion timings:

- Micro hover / focus: **160–220 ms**
- Toggle thumb: **220–280 ms**
- Allocation morph: **380–480 ms spring**
- Inspector open / close: **300–420 ms**
- Initial dashboard load: **500–700 ms maximum**

Use spring physics, not generic CSS ease-in-out for the primary morph.

Suggested Framer Motion direction:

```text
mass:       ~0.8–1.0
stiffness:  ~250–320
damping:    ~26–34
```

Tune visually rather than treating these as immutable constants.

No excessive bouncy animation.

---

# 7. Optional advanced interaction: scrub between L1 and L2

A premium version can make Allocation Depth draggable.

Rather than a binary transition, the user can scrub through hierarchy depth:

### 0%

```text
EQUITY
```

### ~30%

```text
EQUITY
└ subtle internal separators appear
```

### ~60%

```text
Large | Mid | Small | Intl | Sector
```

### 100%

- full L2 geometry,
- labels,
- values,
- veto state,
- parent rails.

This interaction is optional but highly desirable if implementation quality can remain high.

The control should snap cleanly to Overview or Detail on release.

Respect `prefers-reduced-motion`; reduced-motion users should get an instantaneous or short cross-layout transition without parallax/springs.

---

# 8. Parent rails in L2

In detailed mode, a thin parent rail should remain under each group of children:

```text
Large | Mid | Small | Intl | Sector | Short | Corp | Gilt | Gold | Silver
████████████████████████████ ███████████████████████ ███████████
────────── EQUITY ────────── ─────── DEBT ───────── ── METALS ─
```

This solves one of the biggest hierarchy problems in nested allocation visualizations: the user can instantly see which child belongs to which L1 parent.

Do not rely on color alone to communicate hierarchy.

---

# 9. Hover behavior on allocation bar

Hovering/tapping any segment should produce contextual focus.

Example for Small Cap:

```text
Large     Mid     SMALL     Intl     Sector
████      ███     █████     ████     ██
                  ↑
                6.9%
```

Behavior:

- hovered segment remains full opacity,
- siblings in same parent reduce to ~55–70%,
- unrelated parent groups reduce to ~30–40%,
- group rail remains visible,
- tooltip / floating label shows both portfolio weight and parent-relative weight.

Example:

```text
Small Cap
6.9% of portfolio
13.7% of Equity
```

This distinction is essential.

Every L2 sleeve should expose:

- **portfolio weight**, and
- **weight within parent asset class**.

---

# 10. Click behavior on allocation bar

Clicking a segment should not navigate away.

Use a right-side inspector on desktop and bottom sheet on mobile/tablet.

Example Small Cap inspector:

```text
Small Cap                                         6.9%

Neutral equity weight                            15.0%
Model equity weight                              13.7%
Portfolio contribution                            6.9%

Attractiveness                                    33.3
Veto                                             Active

↓ 1.3 pp vs neutral within Equity

Why this changed →
```

Provide tabs within the inspector if useful:

```text
Summary | Signals | Methodology | Funds
```

The selected bar segment and inspector must remain linked visually.

---

# 11. Optional baseline comparison

Neutral and previous published allocations are diagnostic reference states. They help an expert inspect the model, but they are not the primary output.

The Overview must default to the current ideal allocation with **no comparison selected**. A `Compare` control may overlay either:

- policy neutral; or
- previous published ideal allocation.

Never make the page read as if “change from neutral” is the core decision. Neutral is one of the model inputs used to convert scores into weights.

Example:

```text
EQUITY

Neutral                       Model
55.0%  ──────────────────────● 54.5%
                              -0.5 pp

DEBT

Neutral                       Model
35.0%  ─────────────────────────● 35.6%
                                 +0.6 pp
```

For L2:

```text
Large Cap
45.0%  ─────────────────────────● 46.6%
                                 +1.6 pp

Small Cap
15.0%       ●────────────────── 13.7%
            -1.3 pp

            ⚠ Veto active
```

Keep this comparison accessible from Overview and Allocation Logic, but visually subordinate it to the current ideal allocation.

---

# 12. Overview page

The default landing page must immediately show the **current ideal asset allocation calculated from the latest published data and model state**. Comparisons and explanations are secondary layers.

Suggested layout:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ IDEAL ASSET ALLOCATION                         As of 14 Sep 2026 · Current │
│ Based on latest published market data and model inputs                    │
│                                                                            │
│  [MORPHING L1/L2 ALLOCATION BAR]                                          │
│                                                                            │
│  Equity 54.5% · Debt 35.6% · Precious Metals 9.9%                         │
│  [Compare: None ▾]   options: Neutral / Previous published                │
│                                                                            │
├───────────────────────────────┬────────────────────────────────────────────┤
│ MODEL DRIVERS                 │ L2 ALLOCATION                              │
│                               │                                            │
│ Equity       50.5      →      │ Large Cap            23.5%                │
│ Debt         57.5      ↑      │ Mid Cap               9.8%                │
│ Metals       51.3      →      │ Small Cap             6.9%     ⚠          │
│                               │ International        10.2%                │
│ ⚠ Small-cap veto active      │ Capital Goods         4.1%                │
│                               │ Liquid / Short       14.0%                │
│ View calculations →           │ Corporate / Medium   12.3%                │
│                               │ Gilt / Long           9.3%                │
│                               │ Gold                  7.4%                │
│                               │ Silver                2.5%                │
├───────────────────────────────┴────────────────────────────────────────────┤
│ SIGNALS                                                                    │
│                                                                            │
│                Valuation   Macro   Fundamental   Flows   Momentum          │
│ Equity             45        55        55          40       60             │
│ Debt               65        60        55          55       45             │
│ Metals             35        60        65          30       75             │
│                                                                            │
│                           Explore model →                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Do not overload the home screen with many separate charts.

---

# 13. Model Drivers panel

This should identify the actual scores and constraints that produced the current ideal allocation, not pose a vague “Why?” question and not repeat the workbook.

L1 composite scores from current model:

```text
Equity             50.50
Debt               57.50
Precious Metals    51.25
```

Possible concise, model-grounded language:

```text
Debt is modestly favored
Higher carry and supportive rate-cycle signals offset softer momentum.

Equity remains near neutral
Signals are mixed, with no L1 veto active.

Metals remain near neutral
Strong macro/fundamental support is balanced by expensive valuation and crowded flows.
```

Do not present this prose as immutable hardcoded investment advice. It should be generated from model drivers when possible.

---

# 14. Signal Matrix

Replace spreadsheet-style input blocks with a compact, interactive signal matrix.

## Current L1 signals

| Signal | Equity | Debt | Precious Metals |
|---|---:|---:|---:|
| Valuation / carry attractiveness | 45 | 65 | 35 |
| Macro / cycle support | 55 | 60 | 60 |
| Fundamentals | 55 | 55 | 65 |
| Flows & sentiment (contrarian) | 40 | 55 | 30 |
| Momentum (12M relative) | 60 | 45 | 75 |
| **Composite** | **50.50** | **57.50** | **51.25** |

Preferred visual treatment per score:

```text
60
━━━━━━────
```

instead of giant colored heatmap tiles.

Use color sparingly for meaningful extremes.

Clicking a signal cell should open an explanation of:

- raw input,
- percentile / normalization,
- whether inverted,
- weight,
- contribution to composite,
- source / update timestamp if available.

---

# 15. L1 signal weights

From workbook:

| Signal | Weight |
|---|---:|
| Valuation / carry attractiveness | 30% |
| Macro / cycle support | 20% |
| Fundamentals | 20% |
| Flows & sentiment (contrarian) | 15% |
| Momentum (12M relative) | 15% |

Interpretation notes from the framework:

- Equity valuation can use earnings yield vs 10Y G-Sec and index P/E percentile, inverted.
- Debt carry uses real yield / absolute yield percentile; high yield is attractive and is **not inverted**.
- Metals valuation can use real gold price vs history, inverted.
- Flows are contrarian; euphoric inflows produce a lower attractiveness score.
- Momentum is scored as-is; persistent relative strength is modestly positive.

---

# 16. Equity L2 signal details

Weights:

| Signal | Weight |
|---|---:|
| Valuation vs own history | 30% |
| Relative value vs other segments | 20% |
| Earnings revision breadth | 20% |
| Earnings growth differential | 15% |
| Margin / cycle position | 15% |

Current signal values:

| Signal | Large | Mid | Small | International |
|---|---:|---:|---:|---:|
| Valuation vs own history | 55 | 35 | 25 | 40 |
| Relative value vs segments | 60 | 30 | 20 | 45 |
| Earnings revision breadth | 50 | 55 | 45 | 60 |
| Earnings growth differential | 45 | 60 | 55 | 65 |
| Margin / cycle position | 55 | 40 | 30 | 50 |
| **Composite** | **53.50** | **42.50** | **33.25** | **50.25** |

Small Cap has an active veto.

---

# 17. Debt L2 signal details

Weights:

| Signal | Weight |
|---|---:|
| Carry vs history (YTM percentile) | 30% |
| Rate-cycle duration benefit | 30% |
| Credit spread cushion | 25% |
| Liquidity / redemption safety | 15% |

Current signal values:

| Signal | Liquid / Short | Corporate / Medium | Gilt / Long |
|---|---:|---:|---:|
| Carry vs history | 55 | 60 | 65 |
| Rate-cycle duration benefit | 40 | 55 | 70 |
| Credit spread cushion | 50 | 45 | 50 |
| Liquidity / redemption safety | 90 | 65 | 75 |
| **Composite** | **54.50** | **55.50** | **64.25** |

---

# 18. Precious Metals L2 signal details

Weights:

| Signal | Weight |
|---|---:|
| Gold/Silver ratio positioning | 40% |
| Real-rates trend benefit | 35% |
| Industrial demand cycle | 25% |

Current signal values:

| Signal | Gold | Silver |
|---|---:|---:|
| Gold/Silver ratio positioning | 40 | 60 |
| Real-rates trend benefit | 65 | 55 |
| Industrial demand cycle | 50 | 55 |
| **Composite** | **51.25** | **57.00** |

Framework note: Gold is treated as neutral (`50`) on industrial demand.

---

# 19. Veto UX

Vetoes are structurally different from signals and must look different.

They are **risk gates**, not negative scores.

Current workbook rule:

> Vetoes block overweights, never force underweights.

If a veto is active:

```text
SMALL CAP
33

⚠ Overweight blocked

Reason
Risk gate triggered.

The model may reduce the position but cannot overweight it until the veto clears.
```

In allocation bar:

- display a restrained warning glyph,
- do not flood the segment with red,
- tooltip / inspector explains the veto.

Suggested semantics:

```text
Normal             neutral foreground
Positive           green accent
Caution            orange accent
Veto               dark warning glyph + small orange/red accent
Critical error     red
```

Red should be rare.

---

# 20. Sector Satellite

The sector satellite should feel deliberately different from normal L1/L2 allocation.

It is:

- opportunistic,
- capped,
- empty by default,
- carved from Equity,
- gated by qualification threshold,
- constrained by max simultaneous holdings.

## Current sector scores

| Sector | Composite | Status |
|---|---:|---|
| Capital Goods / Infra | **71.00** | **QUALIFIES** |
| Pharma / Healthcare | 57.75 | No |
| Banking / Financials | 55.25 | No |
| Auto | 52.75 | No |
| Energy / Commodities | 50.25 | No |
| Metals | 47.75 | No |
| FMCG / Consumer | 47.50 | No |
| IT Services | 44.00 | No |

Only **Capital Goods / Infra** currently qualifies.

### Sector weights

| Signal | Weight |
|---|---:|
| Valuation vs own history | 30% |
| Earnings revisions & momentum | 30% |
| Relative price momentum (6–12M) | 25% |
| Cycle position | 15% |

Capital Goods / Infra current inputs:

```text
Valuation vs history      60
Earnings revisions        75
Relative momentum         80
Cycle position            70
Composite                 71
```

### Sector sleeve constraints

```text
Sector sleeve cap (% of Equity)      15%
Max sectors held simultaneously       2
Current sectors held                   1
Current deployed sleeve              7.5% of Equity
Current portfolio contribution       ~4.08%
```

Rule:

> If more sectors qualify than the maximum, hold only the highest-composite sectors. Deployed sleeve = sleeve cap × (sectors held ÷ max sectors), split equally.

### UI

```text
Opportunities

1 sector currently qualifies
──────────────────────────────────────

CAPITAL GOODS / INFRA

71                               QUALIFIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●

Valuation                         60
Earnings revisions                75
Relative momentum                 80
Cycle position                    70

Portfolio allocation              4.1%

[View thesis]
```

Then a quieter `Watching` list beneath it.

---

# 21. “What’s driving the portfolio?”

Create a generated insight module that turns model state into 3–5 plain-language decisions.

Example based on current state:

```text
What the model sees

↑ Debt is relatively attractive
  Carry and duration support favor debt modestly.

↓ Small caps remain unattractive
  Weak valuation and relative-value scores; an overweight veto is active.

↑ Capital Goods / Infra is the only sector clearing the satellite threshold.

→ L1 positioning remains close to neutral overall.
```

This should bridge quantitative framework and human understanding.

Do not present dozens of observations.

Rank explanations by materiality.

---

# 22. Model Explorer

Primary segmented navigation inside Model:

```text
Asset Classes | Equity | Debt | Metals | Sectors
```

Suggested table / list layout:

```text
                    Score    Neutral    Model     Change
Large Cap           53.5     45.0%      46.6%     +1.6 pp
Mid Cap             42.5     20.0%      19.4%     -0.6 pp
Small Cap ⚠         33.3     15.0%      13.7%     -1.3 pp
International       50.3     20.0%      20.3%     +0.3 pp
```

Click any row → signal breakdown inspector.

---

# 23. Model Simulation

Provide a premium `Simulate` mode.

The user can alter model signals and observe the allocation respond live.

Example:

```text
Rate-cycle duration benefit
40 ───────────────●────────── 100
                  70

Large Cap valuation
0 ───────●─────────────────── 100
         35
```

As the user moves a score:

- composites update,
- resulting tilts update,
- vetoes remain logically enforced,
- allocation bar morphs live,
- changed values count up/down,
- original vs simulated state is always visible.

Example state header:

```text
SIMULATION

Original                 Simulated
Debt 35.6%               Debt 38.2%
                          +2.6 pp
```

Actions:

```text
Reset
Save scenario
Exit simulation
```

Never confuse simulation with published/current model state.

Use an obvious but tasteful simulation mode treatment.

---

# 24. Methodology screen

Rules, parameters, formulas and weights should not clutter the main dashboard.

Use expandable sections:

```text
How Equity is scored                                   ⌄

Valuation / Carry                    30%
Macro / Cycle                        20%
Fundamentals                         20%
Flows & Sentiment                    15%
Momentum                             15%
```

## Tilt caps from workbook

```text
Max tilt — L1 asset classes         20%
Max tilt — Equity segments          30%
Max tilt — Debt buckets             30%
Max tilt — Gold/Silver split        25%
Sector sleeve cap                   15% of Equity
Max sectors held                      2
```

The methodology should explain philosophy, not expose spreadsheet plumbing by default.

---

# 25. Monitoring & Reviews

The workbook contains a disciplined review cadence that should become a timeline rather than a table.

## Current cadence

| Activity | Frequency | Note |
|---|---|---|
| Log Data Tracker tables | Monthly | ~15 minutes; percentile history is an asset |
| Veto gate check | Monthly | Can trigger between reviews |
| Sector satellite + flows/momentum review | Quarterly | Sectors rotate faster than asset classes |
| Full strategic re-score: L1 + all L2 | Semi-annual | Implement tilt changes over 4–8 weeks |
| Backtest & weight sensitivity | Annual | Test ±10% weight changes; fragile models should be simplified |
| Neutral weight / policy review | Annual | Risk-profile driven only, not framework-driven |

Suggested UI:

```text
MODEL REVIEW

SEP 2026                                             Current
●──────────────────────────────────────────────────────●

Monthly              Data refresh / veto check
Quarterly            Sector review
Semi-annual          Strategic allocation review
Annual               Model sensitivity + policy review
```

Also show `Since last review` changes if historical state exists.

---

# 26. Standing framework rules to preserve

These are product logic, not optional visual notes.

1. **No tilt changes between reviews on news/price alone.** Wait for the appropriate review or a veto trigger.
2. **Vetoes block overweights; they do not force underweights.**
3. **Sector sleeve is empty by default.**
4. A sector exits when its composite falls below threshold at quarterly review.
5. A sector exits after **4 consecutive quarters** in the sleeve regardless of score; rotate out or re-underwrite from scratch.
6. Precious metals are a **diversifier, not a bet**.
7. Precious metals should use neutral ± tilt and never exceed **2× neutral**.
8. Extreme scores (`>80` or `<20`) for **two consecutive reviews** may use the full allowed tilt cap.

These rules should be available in Methodology and respected in any simulation engine.

---

# 27. Visual design language

## 27.1 Overall direction

Use an **Altruist-inspired**, not copied, visual system:

- bright off-white canvas,
- strong black typography,
- generous whitespace,
- thin but confident keylines,
- restrained use of vivid accent color,
- typography-driven hierarchy,
- strong data density without “trading terminal” feeling,
- mix of square-ish analytical containers and softer rounded interactive controls.

The app should feel calm, premium and intelligent.

---

## 27.2 Suggested base palette

These are recommended starting tokens, not a literal copy of Altruist brand assets.

```css
--canvas:             #F7F7F4;
--surface:            #FFFFFF;
--surface-subtle:     #F1F2ED;

--text-primary:       #10110F;
--text-secondary:     #666962;
--text-tertiary:      #90938C;

--border:             #E3E5DE;
--border-strong:      #CBCD C5; /* normalize spacing in implementation */

--accent-green:       #61D58A;
--accent-blue:        #55B8F3;
--accent-orange:      #FF9A52;
--warning:            #E86F51;
```

Implementation should correct any malformed literal token and run contrast checks.

Suggested semantic mapping:

```text
Equity              Blue
Debt                Green
Precious Metals     Warm Orange
Positive            Green
Attention           Orange
Veto                Dark foreground + warning accent
```

However, do **not** force asset-class color onto every element. Most UI should remain black/white/neutral.

Color guides attention rather than decorating the interface.

---

# 28. Typography

Recommended style:

- modern grotesk / neo-grotesk sans,
- high legibility,
- tabular numbers for percentages/scores,
- minimal font weights.

Suggested stack:

```css
font-family: Inter, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
font-variant-numeric: tabular-nums;
```

If building specifically for web and licensing permits, choose a high-quality grotesk with a slightly editorial tone.

Hierarchy example:

```text
Page title               30–36px / 600
Hero number              38–56px / 500–600
Section title            18–22px / 600
Body                     14–16px / 400–500
Meta / labels            11–13px / 500
Tabular numeric labels   12–16px / 500
```

Avoid oversized “fintech marketing” numbers everywhere.

---

# 29. Layout / spacing

Desktop target:

- 12-column grid,
- max content width roughly 1440–1600px,
- 24–32px main gutters,
- 24px common card gap,
- 20–28px card padding,
- 12–16px spacing between compact metrics.

Cards should not all have pill-shaped 24px radii.

Suggested:

```text
Analytical panels     12–16px radius
Interactive sheets    20–24px radius
Tiny controls         pill where appropriate
```

Avoid “every section is a floating rounded card” syndrome.

---

# 30. Interaction principles

1. **Progressive disclosure** — everything is available, not everything is visible at once.
2. **Preserve spatial continuity** — data morphs instead of being replaced.
3. **One primary action per surface.**
4. **Hover reveals detail; click commits focus.**
5. **No dead-end drill-down pages for simple explanations.**
6. **Always give context:** portfolio %, parent %, neutral %, model %, change.
7. **Never use color alone to encode status.**
8. **Motion should encode hierarchy or causality.**
9. **Keep current/model/simulation/user states visually distinct.**

---

# 31. Explicit product boundary

This application ends at the **ideal model allocation**.

It does not include:

- client holdings or CAS import;
- actual-versus-model portfolio gaps;
- mutual-fund or instrument selection;
- transaction recommendations;
- transition plans, tax analysis or portfolio actions.

These may exist as separate downstream products later, but they must not appear in this product's navigation, primary journey, components, acceptance criteria or empty states.

The only valid output journey is:

```text
Current data state
  → signal scores
  → composite scores
  → constraints and vetoes
  → current ideal L1/L2 asset allocation
```

---

# 39. Desktop component map

Suggested React/component hierarchy:

```text
<AppShell>
  <Sidebar />
  <TopBar />

  <OverviewPage>
    <PageHeader />

    <AllocationHero>
      <AllocationDepthControl />
      <MorphingAllocationBar>
        <L1Group />
        <L2Segment />
        <ParentRail />
        <SegmentTooltip />
      </MorphingAllocationBar>
      <NeutralVsModelSummary />
    </AllocationHero>

    <DecisionSummaryGrid>
      <AllocationDriversPanel />
      <AllocationMap />
    </DecisionSummaryGrid>

    <SignalMatrix />
    <ModelDrivers />

    <InspectorDrawer />
  </OverviewPage>
</AppShell>
```

Additional model surfaces:

```text
<DataPointControlCenter />
<CalculationInspector />
<ModelSimulator />
<ReviewTimeline />
```

---

# 40. Suggested data model

Use a hierarchical allocation structure so L1/L2 morphing is a first-class concept rather than hardcoded chart data.

```ts
type AllocationNode = {
  id: string;
  label: string;
  level: 1 | 2;
  parentId?: string;

  portfolioWeight: number;
  weightWithinParent?: number;
  neutralWeightWithinParent?: number;

  compositeScore?: number;
  vetoActive?: boolean;
  status?: 'normal' | 'qualifies' | 'watch' | 'veto';

  colorToken?: string;
  children?: AllocationNode[];
};
```

Example root structure:

```ts
[
  {
    id: 'equity',
    label: 'Equity',
    level: 1,
    portfolioWeight: 0.544511,
    compositeScore: 50.5,
    children: [
      { id: 'large', ... },
      { id: 'mid', ... },
      { id: 'small', vetoActive: true, ... },
      { id: 'international', ... },
      { id: 'sector-capital-goods', ... }
    ]
  },
  {
    id: 'debt',
    ...
  },
  {
    id: 'metals',
    ...
  }
]
```

---

# 41. Animation implementation guidance

If using React, Framer Motion is a strong fit.

Key pattern:

- keep L1 and L2 pieces in the same layout tree,
- use shared layout IDs / layout animations,
- avoid unmounting the entire chart between states,
- derive widths from a stable normalized dataset,
- defer labels when segment width is below legibility threshold,
- use tooltip/hover to expose labels for narrow segments.

Pseudo-structure:

```tsx
<motion.div layout className="allocation-root">
  {view === 'overview'
    ? groups.map(group => (
        <motion.div
          layoutId={`allocation-${group.id}`}
          style={{ width: `${group.portfolioWeight * 100}%` }}
        />
      ))
    : groups.flatMap(group =>
        group.children.map(child => (
          <motion.div
            layout
            style={{ width: `${child.portfolioWeight * 100}%` }}
          />
        ))
      )}
</motion.div>
```

Actual implementation should preserve parent grouping during the morph rather than literally flattening all hierarchy too early.

---

# 42. Responsive behavior

## Desktop

- full ribbon,
- parent labels above,
- parent rails below,
- right-side inspector.

## Tablet

- same horizontal bar if width allows,
- collapse secondary labels,
- inspector becomes bottom sheet.

## Mobile

Do not squeeze ten labeled L2 segments into an unreadable 360px ribbon.

Options:

1. use a horizontally scrollable detailed ribbon with parent snapping, or
2. preserve the 100% bar visually and show selected L2 labels below, or
3. show L1 ribbon and expand one parent at a time for L2.

Preferred mobile behavior:

```text
L1 shows all 3 asset classes.
Tap Equity → Equity occupies the full ribbon width and decomposes into its L2 sleeves.
Back → returns to L1.
```

This maintains the same “physical decomposition” principle without making the chart illegible.

---

# 43. Accessibility

Must include:

- keyboard navigation across allocation segments,
- visible focus rings,
- `aria-label` containing label + portfolio % + parent % + veto state,
- no information conveyed by color alone,
- high contrast for text and boundaries,
- reduced-motion support,
- tooltips accessible via focus, not only hover,
- minimum hit area ~44px where possible.

Example accessibility label:

```text
"Small Cap, 6.9 percent of portfolio, 13.7 percent of Equity, below neutral by 1.3 percentage points, overweight veto active."
```

---

# 44. Loading / update behavior

Avoid skeletonizing every cell.

On initial load:

1. page shell appears immediately,
2. main allocation container resolves,
3. segments animate from neutral / previous positions into current positions,
4. values count into place,
5. secondary panels fade in with slight stagger.

The entire sequence should complete quickly and should not feel theatrical.

On model refresh:

- animate only changed widths / numbers,
- briefly mark changed segments,
- do not replay full page entrance animations.

---

# 45. Empty / missing data states

The dashboard should remain trustworthy when data is incomplete.

Examples:

```text
Signal unavailable
Last valid reading: Aug 2026
```

```text
Sector satellite empty
No sector currently clears the qualification threshold.
```

The empty satellite should look intentional, not broken.

---

# 46. Anti-patterns — explicitly avoid

Do not build:

- a home screen containing 10–15 unrelated charts,
- a donut-first allocation experience,
- a giant red/green heatmap,
- a Bloomberg-terminal visual style,
- a separate page for every workbook sheet,
- generic card soup,
- constant ambient animation,
- decorative gradients with no semantic meaning,
- unexplained “AI allocation score” outputs,
- client holdings, funds, transactions or other downstream product features,
- a simulation mode that can be mistaken for the live model.

---

# 47. MVP recommendation

Build four highly polished model surfaces first.

## Screen 1 — Overview

Must include:

- morphing L1/L2 Allocation Bar,
- current ideal allocation as the dominant answer,
- Neutral / Previous comparison as optional secondary context,
- Allocation Drivers,
- Allocation Map,
- Signal Matrix,
- What the Model Sees,
- segment inspector.

## Screen 2 — Model Explorer

Must include:

- L1/L2 scoring,
- signal contributions,
- neutral vs model tilts,
- veto states,
- methodology,
- optional simulation.

## Screen 3 — Data Point Control Center

Must include automatic, opt-in, manual, derived, parameter and veto inputs; freshness; source lineage; editing; live recalculation; and draft/publish behavior.

## Screen 4 — Reviews & Audit

Must include refresh history, manual changes, governance changes, veto changes, model versions and the ability to reconstruct any published ideal allocation.

---

# 48. Primary UX success criteria

A user opening the dashboard for the first time should understand within seconds:

1. Equity / Debt / Metals allocation.
2. That this is the current ideal allocation implied by the latest model state.
3. Which L2 sleeves make up each L1 allocation.
4. That Small Cap currently has a veto.
5. That Capital Goods / Infra is the only qualifying sector satellite position.
6. Why Debt is somewhat more attractive than Equity at the L1 level.
7. Where to click to understand any number and its underlying data points.

The user should not need to understand workbook formulas before understanding the portfolio.

---

# 49. Engineering acceptance criteria for allocation hero

The hero is complete only when all of the following hold:

- [ ] L1 widths equal 54.4511 / 35.6190 / 9.9298.
- [ ] L2 widths equal final portfolio rollup weights and sum to 100%.
- [ ] L1 → L2 uses layout morphing rather than hard replacement.
- [ ] Parent identity remains obvious in L2.
- [ ] Hover/focus exposes portfolio weight + parent-relative weight.
- [ ] Small Cap veto is visually encoded and accessible.
- [ ] Clicking any segment opens inspector without route change.
- [ ] Neutral vs model context is available for every modeled sleeve.
- [ ] Toggle language supports both friendly names and L1/L2 terminology.
- [ ] Reduced motion is supported.
- [ ] Narrow segments remain discoverable even if labels cannot fit.
- [ ] Mobile has a parent-first decomposition interaction rather than unreadable compressed L2 labels.

---

# 50. Canonical current dataset for prototype

```json
{
  "l1": [
    {
      "id": "equity",
      "label": "Equity",
      "neutralWeight": 0.55,
      "portfolioWeight": 0.5445114119,
      "composite": 50.5,
      "veto": false
    },
    {
      "id": "debt",
      "label": "Debt",
      "neutralWeight": 0.35,
      "portfolioWeight": 0.3561900998,
      "composite": 57.5,
      "veto": false
    },
    {
      "id": "metals",
      "label": "Precious Metals",
      "neutralWeight": 0.10,
      "portfolioWeight": 0.09929848829,
      "composite": 51.25,
      "veto": false
    }
  ],
  "l2": [
    {
      "id": "large-cap",
      "label": "Large Cap",
      "parentId": "equity",
      "weightWithinParent": 0.4311677277,
      "portfolioWeight": 0.2347757482,
      "neutralWeightWithinParent": 0.45,
      "composite": 53.5,
      "veto": false
    },
    {
      "id": "mid-cap",
      "label": "Mid Cap",
      "parentId": "equity",
      "weightWithinParent": 0.179242651,
      "portfolioWeight": 0.09759966896,
      "neutralWeightWithinParent": 0.20,
      "composite": 42.5,
      "veto": false
    },
    {
      "id": "small-cap",
      "label": "Small Cap",
      "parentId": "equity",
      "weightWithinParent": 0.1266194486,
      "portfolioWeight": 0.06894573473,
      "neutralWeightWithinParent": 0.15,
      "composite": 33.25,
      "veto": true
    },
    {
      "id": "international",
      "label": "International",
      "parentId": "equity",
      "weightWithinParent": 0.1879701727,
      "portfolioWeight": 0.1023519041,
      "neutralWeightWithinParent": 0.20,
      "composite": 50.25,
      "veto": false
    },
    {
      "id": "sector-capital-goods",
      "label": "Capital Goods / Infra",
      "parentId": "equity",
      "weightWithinParent": 0.075,
      "portfolioWeight": 0.04083835589,
      "composite": 71,
      "veto": false,
      "status": "qualifies"
    },
    {
      "id": "liquid-short",
      "label": "Liquid / Short",
      "parentId": "debt",
      "weightWithinParent": 0.3935902656,
      "portfolioWeight": 0.140192956,
      "neutralWeightWithinParent": 0.40,
      "composite": 54.5,
      "veto": false
    },
    {
      "id": "corporate-medium",
      "label": "Corporate / Medium",
      "parentId": "debt",
      "weightWithinParent": 0.3464035067,
      "portfolioWeight": 0.1233854996,
      "neutralWeightWithinParent": 0.35,
      "composite": 55.5,
      "veto": false
    },
    {
      "id": "gilt-long",
      "label": "Gilt / Long",
      "parentId": "debt",
      "weightWithinParent": 0.2600062277,
      "portfolioWeight": 0.09261164419,
      "neutralWeightWithinParent": 0.25,
      "composite": 64.25,
      "veto": false
    },
    {
      "id": "gold",
      "label": "Gold",
      "parentId": "metals",
      "weightWithinParent": 0.7446808511,
      "portfolioWeight": 0.07394568277,
      "neutralWeightWithinParent": 0.75,
      "composite": 51.25,
      "veto": false
    },
    {
      "id": "silver",
      "label": "Silver",
      "parentId": "metals",
      "weightWithinParent": 0.2553191489,
      "portfolioWeight": 0.02535280552,
      "neutralWeightWithinParent": 0.25,
      "composite": 57,
      "veto": false
    }
  ]
}
```

**Important nuance:** The equity `weightWithinParent` values in Portfolio Rollup are after the sector sleeve is carved out and therefore represent the final portfolio composition. The raw Equity Segments model outputs before sector carve-out are 46.6127%, 19.3776%, 13.6886%, and 20.3211%. Keep both concepts distinct in the implementation.

---

# 51. Complete UX page inventory

The product must be designed as a coherent system of pages, not only a dashboard hero. The following page inventory is canonical for implementation.

| Page | Primary purpose | Key UX components | MVP status |
|---|---|---|---|
| **Overview** | Show the current ideal asset allocation produced by the latest published model state | L1/L2 morphing allocation bar, model timestamp, dominant drivers, active vetoes, optional neutral/previous overlays | Required |
| **Allocation Detail** | Inspect one L1 or L2 sleeve without leaving the decision context | sleeve header, score, neutral/model/final weights, driver waterfall, dependency trace, exact calculation drawer | Required |
| **Model Explorer** | Explore scores, tilts, vetoes and allocations across L1, Equity, Debt, Metals and Sectors | matrix/table toggle, group tabs, expandable score rows, formula access, source freshness | Required |
| **Data Point Control Center** | Review, refresh, manually update and override every model input; preview allocation impact before publishing | searchable data registry, categories, update mode, frequency/freshness, bulk refresh, inline edit, draft state, live impact sidebar, save/publish flow | Required |
| **Calculation Inspector** | Make every composite and allocation calculation independently understandable | formula, substituted values, weighted contributions, normalization, caps, veto application, rounding, upstream/downstream dependency graph | Required; may be a drawer/inner route |
| **Scenarios / Drafts** | Compare proposed input changes without changing the published model | scenario name, changed inputs, before/after scores and allocation, save draft, compare, discard, publish | Required as lightweight capability; full library can follow |
| **Methodology & Governance** | Explain and administer weights, neutrals, tilt limits, percentile rules and sector constraints | expandable rule groups, version history, impact warning, permissions, approval state | Required for admin users |
| **Reviews & Audit Log** | Provide continuity and accountability across model updates | timeline, data refresh events, manual edits, parameter changes, veto changes, published allocation versions, actor/reason/timestamp | Required |
The product is a **general asset-allocation model/engine for a wealth manager**, driven by current data points, market conditions and governed model rules. Its endpoint is the published ideal allocation.

## 51.1 Recommended navigation

```text
Overview
Model
  Data Points
  Signals & Scores
  Allocation Logic
  Methodology
Reviews
```

`Data Points` must be first-class navigation under Model. It must not be hidden inside Settings because it is part of the wealth manager's recurring investment workflow.

---

# 52. Data Point Control Center

This page is the operational heart of the product. It answers five questions immediately:

1. What data does the model use?
2. Where did each value come from?
3. Is it current or stale?
4. What depends on it?
5. What would change if it were updated?

## 52.1 Page layout

Use a three-region desktop layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Data Points               85 score cells · 22 auto-wired · 63 manual        │
│ Last refresh 14 Sep, 10:30   4 stale   2 failed     [Refresh all] [Review]  │
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│ FILTERS      │ DATA REGISTRY                             │ LIVE IMPACT       │
│              │                                           │                   │
│ All          │ Search…      Group · Source · Freshness   │ Draft changes 3   │
│ Governance   │                                           │                   │
│ Market       │ Equity / Valuation                        │ Equity 54.5→53.8  │
│ Manual       │ Midcap 150 P/E       34.2   NSE   Current │ Debt   35.6→36.3  │
│ Derived      │ Used by: Mid Cap valuation                │ Metals  9.9→ 9.9  │
│ Vetoes       │                                           │                   │
│              │ Small-cap flow froth    Off   Manual      │ Why it changed    │
│ Status       │ Used by: Small Cap veto                   │ Mid score −4.2    │
│ Current      │                                           │ Equity comp −0.7  │
│ Due          │ …                                         │ Allocation −0.7   │
│ Stale        │                                           │                   │
│ Failed       │                                           │ [Discard] [Save]  │
└──────────────┴───────────────────────────────────────────┴───────────────────┘
```

The center registry scrolls. Filters and impact sidebar remain sticky. The allocation preview in the sidebar uses the same spatial/color language as the homepage hero, so the user understands that the result being previewed will become the published homepage allocation.

## 52.2 Summary header

The header must show:

- total model inputs and score cells;
- automatically sourced vs manually maintained counts;
- current, due, stale and failed counts;
- last successful full refresh;
- current published model version;
- pending draft-change count;
- `Refresh all` and `Review changes` actions.

Do not show a generic green “healthy” status if some manual or opt-in inputs are overdue. Summaries must be numerically reconcilable with the filtered registry.

## 52.3 Registry information hierarchy

Each row must expose, without opening a detail page:

| Field | Requirement |
|---|---|
| Name | Human-readable label first; technical key available as secondary text/copy action |
| Current value | Value plus unit; never display an unqualified number |
| Score/bucket | Resulting 0–100 score or rubric bucket when applicable |
| Update type | Automatic, opt-in connector, manual, derived, or governance |
| Source | Provider/system/manual owner |
| Freshness | `Current`, `Due`, `Stale`, `Failed`, or `Definition changed` |
| Last updated | Absolute date/time on detail; concise relative time in row |
| Frequency | Daily, monthly, quarterly, event-driven, annual, or static/review-driven |
| Dependency | Immediate consumer, e.g. `Mid Cap → Valuation`; show `+N more` where needed |
| State | Published, draft override, fetched preview, or validation error |

Rows can expand inline to show description, series history, source URL/identifier, previous value, definition breaks, notes and direct dependants. Clicking the dependency opens the Calculation Inspector focused on that path.

## 52.4 Grouping modes

The user can switch between:

- **By model:** L1, Equity, Debt, Metals, Sectors, Vetoes, Governance.
- **By operation:** Automatic, Opt-in, Manual, Derived, Parameters.
- **By attention:** Failed, Stale, Due soon, Draft changed, Current.

Default to **By model**, because it matches the wealth manager's mental model. Persist the user's last selection.

---

# 53. Canonical data-point taxonomy and controls

The attached operating inventory must be represented using the following five UX types.

## 53.1 Governance parameters — static but overridable

| Parameter group | Meaning | Control | Update cadence |
|---|---|---|---|
| `signalWeights.l1` | Weights combining valuation, macro, fundamentals, flows and momentum into L1 composites | percentage inputs that must total 100% | review-driven |
| `signalWeights.equity/debt/metals/sector` | Signal weights per model group | percentage inputs that must total 100% within each group | review-driven |
| `neutralWeights.l1/equity/debt/metals` | Policy neutral allocations | constrained percentage editor; each sibling group totals 100% | strategic review |
| `maxTilt` | Maximum deviation from neutral | numeric/percentage inputs with impact warning | strategic review |
| `sector.sleeveCap`, `maxSectors`, `threshold`, `maxConsecutiveQuarters` | Sector satellite governance | numeric controls with validation | quarterly/strategic review |
| `normalisation` | Proportional vs zero-sum normalization | explicit segmented selection with explanation | rare governance change |
| `percentileWindowYears`, `percentileMinObservations` | History window and minimum sample | numeric controls | methodology review |
| `respectDefinitionBreaks` | Include/exclude history across definition changes | toggle with high-impact warning | methodology review |

Governance changes must never look like ordinary data edits. They require a reason, show breadth of impact, and should support maker/checker approval if permissions exist.

## 53.2 Automatically fetched external inputs

| Data family | Source | Refresh mode | Suggested cadence label |
|---|---|---|---|
| `nifty50_pe`, `nifty100_pe`, `midcap150_pe/pb`, `smallcap250_pe/pb` | NSE `api/allIndices` | Default | market-day/daily |
| `sector_pe_{banking,it,pharma,auto,fmcg,energy,metals}` | NSE `api/allIndices` | Default | market-day/daily |
| `sector_pe_capgoods`, `sector_pb_capgoods`, `nifty50_close`, `sector_close_*` | niftyindices.com Daily Snapshot CSV | Default | market-day/daily |
| `gsec_10y` | FRED `INDIRLTLT01STM` | Default | source-dependent; show observed-at date |
| `us_real_10y` | FRED `DFII10` | Default | daily |
| `gold_inr`, `silver_inr` | metals.dev, IBJA-benchmarked | Default | daily |
| `flow_*`, `aum_*` | AMFI PDF | Default | monthly |
| `repo_rate` | RBI homepage | Default | event-driven / verify daily |
| `cpi_index`, `cpi_yoy`, `tbill_1y` proxy | RBI DBIE mirror | Opt-in `rbi` | monthly/source-dependent |
| preferred `tbill_1y` | CCIL ZCYC | Opt-in `ccil` | market-day/daily |
| `sp500_fwd_pe`, `gold_etf_shares_outstanding` | Yahoo quote + Wikipedia / Yahoo | Opt-in `yahoo` | daily |
| `gold_usd_futures`, `silver_usd_futures` | Yahoo chart | Opt-in `yahoo_metals` | daily |
| `cb_gold_reserves_tonnes` | DBnomics / IMF IFS | Opt-in `dbnomics` | monthly/source-dependent |
| `global_mfg_pmi` | TradingEconomics HTML | Opt-in `tradingeconomics` | monthly |

For automatic rows, the primary action is `Refresh`, not `Edit`. A manual override is a secondary action and must require a reason and expiry policy. The UI must distinguish:

- **observed at:** the date the source value represents;
- **fetched at:** when the system retrieved it;
- **effective in model:** which published model version uses it.

## 53.3 Auto-wired derived score cells

There are currently **22 auto-wired score cells out of 85**. They include:

- `l1.equity/debt/metals::flows`;
- `equity.{large,mid,small}::valuation`;
- sector valuation for Banking, IT, Pharma, Auto, FMCG, Energy, Metals and Capital Goods;
- Gold/Silver `ratio_position`;
- L1 Metals fundamentals, momentum and macro;
- Gold/Silver real-rates signals;
- L1 Equity momentum;
- L1 Debt valuation;
- Debt Gilt/Liquid carry.

Derived cells are read-only. Their action is `View calculation`. If an upstream value changes, animate the derived score update and briefly highlight the changed contribution; never allow direct editing that would break lineage.

## 53.4 Manual and rubric-based inputs

| Input | UX control | Required context |
|---|---|---|
| International-equity valuation | rubric picker, optionally supported by evidence/note | definition, current bucket, previous bucket, owner, review due date |
| Corporate bond carry (`aaa_3y`) | numeric input with unit | source note/evidence, observed date |
| Category-average YTM for Liquid/Corporate/Gilt funds | numeric inputs with unit | source/evidence and observation date |
| Banking-system liquidity surplus/deficit | signed numeric input with unit | source note, observed date |
| RBI path expectation | semantic picker: cuts / hold / hike, mapped visibly to a score | rationale and review date |
| Remaining ~63 score cells | rubric picker by default; numeric only where methodology defines it | rubric definitions, evidence, owner, review frequency |

Manual inputs should not be free-text score boxes unless no rubric exists. A picker should say what each choice means and show the resulting score before selection. Every manual update requires `as of date`; material changes require a short rationale.

## 53.5 Vetoes

Manual vetoes are `flow_froth`, `parabolic`, `currency_stress`, `liquidity`, `earnings_collapse`, and `credit_event`.

Each veto control must show:

- inactive/active state;
- the allocation(s) it can clamp;
- the exact clamp behavior;
- activation rationale and evidence;
- owner, activation time and review/expiry date;
- before/after allocation impact.

Activating a veto is a high-impact action. Use a deliberate confirmation step, never a casual switch that publishes immediately.

---

# 54. Editing and publishing workflow

The model must separate **published state** from **working draft state**.

## 54.1 State model

```text
Published inputs
      ↓ edit / refresh preview
Working draft
      ↓ real-time recalculation
Impact review
      ↓ Save draft or Publish
New published model version
      ↓
Overview homepage updates
```

`Save` must not be ambiguous:

- **Save draft** preserves a scenario without changing the homepage.
- **Publish allocation** creates a new immutable model version and updates the homepage.

If the initial product uses only one button, label it `Review & publish`, never `Save`.

## 54.2 Inline edit flow

1. User selects/edit a value.
2. Validate type, unit, allowed range, chronology and sibling-total constraints.
3. Recompute affected downstream nodes immediately in memory/server preview.
4. Update the impact sidebar with before/after values.
5. Mark the row as `Draft changed`; preserve original value next to it.
6. Let the user inspect dependencies and exact calculations.
7. Require rationale/as-of date when applicable.
8. User saves draft, discards, or enters review/publish.

Keyboard behavior matters: Enter confirms an input edit, Escape reverts that field, and Cmd/Ctrl+Enter opens review—not immediate publication.

## 54.3 Bulk refresh flow

`Refresh all` first fetches into a preview batch. It must show successful, unchanged, changed and failed sources. The user can review material changes before publishing the recomputed allocation. A partial-source failure must not silently mix stale and fresh values; disclose the exact fallback and block publication when a required input violates policy.

## 54.4 Publish review

The review screen/drawer contains:

- all changed inputs grouped by type;
- before/after values and percentage/absolute deltas;
- stale or failed sources still in use;
- affected scores and composites;
- before/after L1 and L2 allocation;
- newly activated/cleared vetoes;
- validation warnings;
- publish note/reason;
- effective date;
- final `Publish allocation` action.

Publication creates a version that can be reconstructed exactly later.

---

# 55. Live Impact sidebar

The right sidebar is always visible once the draft differs from published state.

## 55.1 Default contents

```text
LIVE IMPACT · DRAFT

3 inputs changed

Allocation
Equity        54.5% → 53.8%   −0.7
Debt          35.6% → 36.3%   +0.7
Metals         9.9% →  9.9%    0.0

Largest sleeve changes
Mid Cap        9.8% →  9.1%   −0.7
Gilt / Long    9.3% → 10.0%   +0.7

Why
Mid valuation score      −8.0
Equity composite         −1.2
Debt relative tilt       +0.7%

[View full calculation]

[Discard] [Review & publish]
```

Only show non-zero/material changes by default, with `Show all` available. Distinguish percentage points from relative percent changes.

## 55.2 Change attribution

When multiple inputs change, provide:

- **total combined impact**;
- **per-input isolated impact** based on the published baseline;
- an explicit note when effects are non-additive because of normalization, caps, thresholds or vetoes;
- ordered causal paths for the largest changes.

Do not claim exact additive attribution when the calculation is non-linear. Label isolated impacts as estimates where appropriate.

## 55.3 Sidebar motion

- On first draft edit, the sidebar slides in over 320–400 ms while the registry resizes smoothly.
- Changed allocation blocks morph from published geometry to draft geometry.
- Affected segments pulse once with a soft accent; no continuous animation.
- Hovering a changed score highlights its upstream edited rows and downstream allocation segments.
- Reverting the last change collapses the sidebar back into a small `No unpublished changes` state.

---

# 56. Dependency and lineage UX

Dependency visibility is a core trust feature, not secondary documentation.

## 56.1 Universal “Why?” interaction

Every score, composite, tilt and final weight supports `Why this value?`. The response opens the Calculation Inspector at the selected node.

The canonical causal chain is:

```text
Raw / manual input
  → transformation or percentile/rubric score
  → signal score
  → weighted contribution
  → composite score
  → raw tilt
  → capped/veto-adjusted tilt
  → normalization
  → L1 or L2 model weight
  → sector carve-out where applicable
  → final portfolio weight
```

## 56.2 Best visual treatment

Use a **focus-path lineage view**, not a full graph of all 85 cells. A selected result appears on the right, its immediate inputs on the left, and the active path is highlighted. Unrelated branches collapse into `+N other inputs`.

Example:

```text
Midcap 150 P/E 34.2
Percentile score 28
        ↓ × valuation weight 30%
Mid Cap composite 42.5
        ↓ score-to-tilt mapping
Raw tilt −1.1%
        ↓ cap / normalize / no veto
Mid Cap within Equity 19.4%
        ↓ Equity weight / sector carve-out
Final portfolio weight 9.8%
```

Clicking any node replaces the inspector with that node's formula and context while preserving breadcrumbs. On hover, corresponding nodes in the allocation bar and signal matrix highlight together.

## 56.3 Dependency badges in the registry

Examples:

- `Feeds 1 score · Mid Cap valuation`
- `Feeds 8 scores · Sector valuations`
- `Affects all allocations · Neutral weights`
- `Can clamp Small Cap overweight · Flow froth veto`

Governance parameters with broad blast radius should display a high-impact badge before editing.

---

# 57. Calculation Inspector

The Calculation Inspector can be opened as a wide right drawer from any page and as a dedicated inner route for deep inspection/shareable links.

## 57.1 Required anatomy

1. **Result header:** name, value, unit, state, model version and as-of time.
2. **Plain-English explanation:** one or two sentences describing what the result means.
3. **Formula:** symbolic equation.
4. **Substitution:** the exact values used in the current/draft calculation.
5. **Contribution table:** input score, weight, weighted contribution and provenance.
6. **Adjustments:** caps, vetoes, normalization, thresholds and sector carve-outs in the order applied.
7. **Before/after:** published versus draft result and change attribution.
8. **Lineage:** upstream inputs and downstream consumers.
9. **Metadata:** source, observed/fetched/effective dates, methodology version, precision and rounding.

## 57.2 Composite-score example

```text
Equity composite =
  Valuation × 30%
+ Macro × 20%
+ Fundamentals × 20%
+ Flows × 15%
+ Momentum × 15%

= 45×0.30 + 55×0.20 + 55×0.20 + 40×0.15 + 60×0.15
= 50.5
```

The UI must show `13.5 + 11.0 + 11.0 + 6.0 + 9.0 = 50.5` as a contribution breakdown. If methodology weights differ by group, use the actual selected group's weights—never reuse illustrative defaults.

## 57.3 Allocation calculation

Show each calculation stage separately:

```text
Composite score
→ score-to-tilt conversion
→ raw weight against neutral
→ maximum-tilt cap
→ veto clamp
→ normalization across siblings
→ parent multiplication
→ sector sleeve carve-out
→ final portfolio weight
```

Never collapse these into one unexplained formula. Each line shows its input, output and whether it changed the value.

## 57.4 Precision rules

- Store and calculate at full engine precision.
- Show allocations to one decimal by default and two or more decimals in the inspector.
- Show an explicit `Displayed values may not sum due to rounding` note only when necessary.
- The inspector's substituted formula must reconcile to the displayed detailed result within the stated rounding rule.

---

# 58. Freshness, frequency and data-quality UX

Freshness is determined from the data point's declared cadence, not one universal threshold.

| State | Meaning | Treatment |
|---|---|---|
| Current | Within expected cadence | neutral/current status |
| Due soon | Approaching expected refresh/review date | subtle attention marker |
| Stale | Past tolerated window | amber status; expose downstream impact |
| Failed | Latest refresh failed | error status plus last-good value |
| Missing | No valid value exists | block dependent calculation/publication as policy dictates |
| Definition changed | Series definition break may invalidate history | methodology warning; require review |
| Overridden | Source value replaced manually | persistent badge, reason, owner and expiry |

The system must retain the last-good value and disclose when it is being used. A stale-data warning should answer “which scores and allocation sleeves currently depend on this?”

---

# 59. Audit, permissions and recoverability

Every mutation event records:

- technical key and human label;
- before/after value and unit;
- source or update mechanism;
- actor;
- timestamp and as-of date;
- reason/note/evidence reference;
- affected draft/published version;
- recomputation result;
- override expiry when relevant.

Suggested roles:

- **Viewer:** inspect allocation, inputs, calculations and history.
- **Editor:** change manual inputs and create drafts.
- **Data operator:** refresh sources and resolve failures.
- **Model admin:** change governance parameters and vetoes.
- **Publisher/approver:** publish a new allocation version.

Support restoring a prior model version by creating a new version from it; do not rewrite audit history.

---

# 60. Additional engineering acceptance criteria

1. Editing any valid data point recalculates all affected downstream values without a full page reload.
2. Unaffected values remain referentially stable and do not animate.
3. Published and draft state are visually and technically distinct.
4. The homepage reads only the latest successfully published model version.
5. Every displayed score/composite/allocation has a stable `Why this value?` entry point.
6. Calculation Inspector values reconcile with engine output using declared precision.
7. Source data stores observed-at, fetched-at and effective-in-model timestamps separately.
8. Refresh failures retain and label the last-good value; required missing inputs can block publication.
9. Derived cells cannot be edited directly.
10. Manual overrides require reason, actor and expiry/review date.
11. Weight groups validate to 100%; allocations validate to 100% after normalization within tolerance.
12. Vetoes and caps are applied and displayed in deterministic engine order.
13. Impact attribution does not falsely present non-linear effects as additive.
14. Publish creates an immutable, reproducible version with input snapshot and methodology version.
15. Deep links can open a specific data point or calculation node.
16. Filters, expanded groups and selected dependency path are URL-addressable where practical.
17. Loading, stale, failed, missing, overridden and draft states have tested UI variants.
18. No client holdings, fund selection or transaction data is required or permitted in the core model journey.

---

# 61. Updated MVP scope

The first useful release should include five polished experiences:

1. **Overview** — current ideal L1/L2 allocation as the dominant answer, with model-state timestamp and key drivers; neutral/previous are optional comparison overlays only.
2. **Model Explorer** — signal matrix, composites, vetoes, tilts and sleeve allocation.
3. **Data Point Control Center** — actual registry, refresh/manual update flows, draft preview and publish.
4. **Calculation Inspector** — exact, reconcilable formulas and dependency lineage from every important value.
5. **Reviews & Audit** — freshness, model versions and change history.

The MVP ends at a transparent, versioned ideal asset allocation. Product selection and client-portfolio workflows are outside this specification.

---

# 62. Final product principle

The spreadsheet is the **model configuration and calculation engine**.

The application is the **asset-allocation model interface**.

Do not visually reproduce the workbook.

The application should translate model state into:

```text
Current market and manual inputs
  ↓
Signal scores and composite scores
  ↓
Rules, thresholds, caps and vetoes
  ↓
Current ideal L1/L2 asset allocation
  ↓
Optional comparison with neutral or previous published model state
```

The **Morphing L1/L2 Allocation Bar** is the visual and interaction anchor around which the rest of the dashboard should be designed.

If only one component receives exceptional design and engineering effort, it should be this one.
