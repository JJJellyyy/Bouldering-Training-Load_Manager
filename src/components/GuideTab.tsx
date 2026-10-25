import { useMemo } from "react";
import {
  calculateGradeIntensity,
  calculateSpeedMultiplier,
  gradeFromNumber,
  gradeToDisplay,
  gradeToNumber,
} from "../domain/loadCalculator";
import { GRADES, type AppSettings, type Grade } from "../types";
import { formatCompact } from "./charts/chartUtils";
import { CurveChart, EwmaWeightsChart } from "./ModelCharts";

const SECTIONS = [
  { id: "start", title: "Getting started" },
  { id: "load", title: "How load is counted" },
  { id: "acwr", title: "ACWR and the zones" },
  { id: "next", title: "What to climb next" },
  { id: "trends", title: "Trends: monotony & strain" },
  { id: "readiness", title: "Sleep, stress & readiness" },
  { id: "strength", title: "Strength (FitNotes)" },
  { id: "toplogger", title: "TopLogger sync" },
  { id: "data", title: "Your data" },
  { id: "maths", title: "The maths, step by step" },
  { id: "faq", title: "FAQ" },
] as const;

function scrollToSection(id: string): void {
  document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Explains every number in the app, using the reader's own settings where it helps. */
export function GuideTab({ settings, referenceGrade }: { settings: AppSettings; referenceGrade: Grade }) {
  const grade = (value: Grade) => gradeToDisplay(value, settings.gradeDisplayUnit);
  const { basePoints, multiplierPerGrade } = settings.model.gradeIntensity;
  const { acuteWindow, chronicWindow, lowThreshold, highThreshold } = settings.model.acwr;

  // Worked example around the reader's current max grade.
  const example = useMemo(() => {
    const problems = 24;
    const duration = 120;
    const baseGrade = gradeFromNumber(gradeToNumber(referenceGrade) - 1);
    const hardGrade = gradeFromNumber(gradeToNumber(baseGrade) + 2);
    const acuteAlpha = 2 / (acuteWindow + 1);
    const chronicAlpha = 2 / (chronicWindow + 1);

    const points = calculateGradeIntensity(baseGrade, referenceGrade, settings);
    const speed = calculateSpeedMultiplier(problems, duration, settings);
    const load = problems * points * speed;
    // A steady routine of two such sessions a week: both averages sit at 2/7 of one session's load.
    const previous = (load * 2) / 7;
    const project = (newLoad: number) => {
      const acute = acuteAlpha * newLoad + (1 - acuteAlpha) * previous;
      const chronic = chronicAlpha * newLoad + (1 - chronicAlpha) * previous;
      return { acute, chronic, acwr: chronic > 0 ? acute / chronic : 0 };
    };

    const hardLoad = problems * calculateGradeIntensity(hardGrade, referenceGrade, settings) * speed;
    const fasterLoad = problems * points * calculateSpeedMultiplier(problems, 75, settings);
    const moreLoad = 32 * points * calculateSpeedMultiplier(32, duration, settings);

    return {
      problems,
      duration,
      baseGrade,
      hardGrade,
      points,
      speed,
      load,
      next: project(load),
      hard: { load: hardLoad, acwr: project(hardLoad).acwr },
      faster: { load: fasterLoad, acwr: project(fasterLoad).acwr },
      more: { load: moreLoad, acwr: project(moreLoad).acwr },
    };
  }, [settings, referenceGrade, acuteWindow, chronicWindow]);

  const variations = [
    { title: `Two grades harder (${grade(example.baseGrade)} → ${grade(example.hardGrade)})`, ...example.hard },
    { title: `Faster (${example.duration} → 75 min)`, ...example.faster },
    { title: `More problems (${example.problems} → 32)`, ...example.more },
  ];

  const gradeCurve = useMemo(
    () => GRADES.map((value) => ({ x: gradeToNumber(value), y: calculateGradeIntensity(value, referenceGrade, settings) })),
    [settings, referenceGrade],
  );
  const speedCurve = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => {
        const problemsPerHour = 8 + index * 4;
        return { x: problemsPerHour, y: calculateSpeedMultiplier(problemsPerHour, 60, settings) };
      }),
    [settings],
  );

  return (
    <section className="guide">
      <nav className="guide-nav" aria-label="Guide sections">
        <p className="guide-nav-title">Guide</p>
        {SECTIONS.map((section) => (
          <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>
            {section.title}
          </button>
        ))}
      </nav>

      <div className="guide-content">
        <article className="panel guide-section" id="guide-start">
          <h2>Getting started</h2>
          <p>
            Boulder Load Manager keeps track of how much you climb and lifts, and warns you before a sudden jump in training
            turns into an injury. It compares what you did recently with what you are used to, and suggests sessions that keep
            the two in balance.
          </p>
          <ol className="guide-steps">
            <li>
              <strong>Get your climbing in.</strong> At a TopLogger gym, connect TopLogger on the Bouldering tab and your
              sessions sync by themselves. Otherwise log them on the Sessions tab.
            </li>
            <li>
              <strong>Add your strength training</strong> (optional). Export your workouts from FitNotes as CSV and import them
              on the Strength tab.
            </li>
            <li>
              <strong>Sign in with Google</strong> (optional) to back everything up to your Google Drive.
            </li>
            <li>
              <strong>Check the Bouldering tab</strong> before you go climbing: it tells you where you stand and what to climb.
            </li>
          </ol>
          <p className="muted-hint">The first few weeks the numbers are still calibrating; they get reliable after about {chronicWindow} days of history.</p>
        </article>

        <article className="panel guide-section" id="guide-load">
          <h2>How load is counted</h2>
          <p>Every session gets a single number, its <em>load</em>: how hard it was on your body, fingers and skin.</p>
          <dl className="guide-terms">
            <dt>Points per problem</dt>
            <dd>
              A problem at your current max grade is worth <strong>{basePoints} points</strong>. Each grade harder multiplies that by{" "}
              <strong>{multiplierPerGrade.toFixed(2)}</strong>, each grade easier divides it. With your current max of{" "}
              <strong>{grade(referenceGrade)}</strong>, a {grade(gradeFromNumber(gradeToNumber(referenceGrade) - 2))} is worth{" "}
              {calculateGradeIntensity(gradeFromNumber(gradeToNumber(referenceGrade) - 2), referenceGrade, settings).toFixed(1)} points
              and a {grade(gradeFromNumber(gradeToNumber(referenceGrade) + 1))} is worth{" "}
              {calculateGradeIntensity(gradeFromNumber(gradeToNumber(referenceGrade) + 1), referenceGrade, settings).toFixed(1)}.
            </dd>
            <dt>Your current max grade</dt>
            <dd>
              The hardest grade you logged on at least <strong>two different days</strong> in the past year. One lucky send or a
              single go on a project doesn't count. Older sessions are measured against the max you had back then, so getting
              stronger doesn't make your old sessions look easy.
            </dd>
            <dt>Pace</dt>
            <dd>
              Climbing many problems in little time is harder than the same problems spread out. At 10 minutes or more per
              problem there's no bonus; at 1 minute per problem load goes up by {settings.model.speed.impactPercent}%.
            </dd>
            <dt>What doesn't count</dt>
            <dd>
              Sleep and stress. A bad night doesn't make a session bigger, it makes you less ready for one, so those show up as
              readiness instead.
            </dd>
          </dl>
          <p className="guide-formula">session load = Σ (problems × points) × pace</p>
        </article>

        <article className="panel guide-section" id="guide-acwr">
          <h2>ACWR and the zones</h2>
          <p>
            ACWR stands for <em>acute:chronic workload ratio</em>. It divides what you did recently by what you are used to.
          </p>
          <dl className="guide-terms">
            <dt>Acute load</dt>
            <dd>
              Your recent load: an average over roughly the last <strong>{acuteWindow} days</strong>, where yesterday counts more
              than a week ago.
            </dd>
            <dt>Chronic load</dt>
            <dd>What your body is used to: the same kind of average over roughly <strong>{chronicWindow} days</strong>.</dd>
            <dt>The ratio</dt>
            <dd>
              Around 1.0 means you are doing what you are used to. Higher means you are ramping up; lower means you are backing
              off. Rest days count as zero, so ACWR drops while you rest.
            </dd>
          </dl>
          <div className="guide-zones">
            <div className="zone-row detraining">
              <strong>Detraining · below {lowThreshold.toFixed(2)}</strong>
              <span>You are doing less than you are used to. Fine for a deload; for long it means losing fitness.</span>
            </div>
            <div className="zone-row goldilocks">
              <strong>Sweet spot · {lowThreshold.toFixed(2)}–{highThreshold.toFixed(2)}</strong>
              <span>Enough to keep building, without sudden jumps.</span>
            </div>
            <div className="zone-row high-risk">
              <strong>High risk · above {highThreshold.toFixed(2)}</strong>
              <span>A spike compared to what you are used to. This is where overuse injuries tend to start.</span>
            </div>
          </div>
          <p className="muted-hint">
            Honest caveat: the sweet-spot numbers come from team-sport research and have never been tested on climbers. Use
            ACWR as a trend to steer by, not a hard rule. You can change the thresholds in Settings.
          </p>
        </article>

        <article className="panel guide-section" id="guide-next">
          <h2>What to climb next</h2>
          <p>
            The Bouldering tab works out how much load your next session can carry and still keep you in the sweet spot, then
            shows three ways to spend it, as grades and numbers of problems.
          </p>
          <dl className="guide-terms">
            <dt>Volume</dt>
            <dd>Lots of easier problems, 1–3 grades below your max. Uses the most load: good for mileage and movement.</dd>
            <dt>Medium</dt>
            <dd>A mix around your solid grades with a few at your limit.</dd>
            <dt>High intensity</dt>
            <dd>
              Few problems at and just above your max, with long rests. Uses less total load, but each attempt is hard. It is{" "}
              <strong>never suggested while your ACWR is over {highThreshold.toFixed(2)} or within 0.10 of it</strong>.
            </dd>
            <dt>Deload week</dt>
            <dd>
              When you are over the limit, stopping completely isn't the answer. Instead you get a deload: sessions about half your
              usual size and a grade easier, at your usual number of sessions a week, plus where that takes your ACWR after a week.
              At most a day or two of full rest is ever suggested.
            </dd>
          </dl>
          <p>
            Normally every option ends below an ACWR of {(highThreshold - 0.05).toFixed(2)}. If you tend to climb a huge session,
            rest a lot and then climb huge again, following these keeps your sessions closer to the same size, which flattens
            those swings.
          </p>
          <p className="muted-hint">
            "Try your own session" lets you check any session you have in mind, on any date.
          </p>
        </article>

        <article className="panel guide-section" id="guide-trends">
          <h2>Trends: monotony & strain</h2>
          <dl className="guide-terms">
            <dt>Week over week</dt>
            <dd>
              This week's total load compared with last week's. Rises of more than about 10–15% a week are where ramps get
              risky; the app flags them.
            </dd>
            <dt>Monotony</dt>
            <dd>
              How similar your days are: the average daily load of the last 7 days divided by how much it varies. Mixing hard
              days with easy and rest days keeps it low. <strong>Above 2</strong> means every day is about the same, which wears
              you down even at a moderate load.
            </dd>
            <dt>Strain</dt>
            <dd>
              Weekly load × monotony. High strain means both a lot of training and little variation, the combination most linked
              to getting run down or ill.
            </dd>
          </dl>
        </article>

        <article className="panel guide-section" id="guide-readiness">
          <h2>Sleep, stress & readiness</h2>
          <p>
            When you log a session you can add how long and how well you slept, your stress and your motivation. These don't
            change load; they give a readiness verdict instead:
          </p>
          <dl className="guide-terms">
            <dt>Ready</dt>
            <dd>Well rested, low stress, motivated.</dd>
            <dt>Okay</dt>
            <dd>One thing is off, like an hour short on sleep or high stress. Fine to train; keep to the lower end of your plan.</dd>
            <dt>Take it easy</dt>
            <dd>Several things are off. A good day for the volume option, or for rest.</dd>
          </dl>
          <p>
            Short sleep is measured against your ideal of {settings.model.recovery.personalMaxSleepHours} hours (Settings). The
            Bouldering tab charts your sleep and stress week by week. Synced TopLogger sessions only count there once you edit
            them, because TopLogger doesn't know how you slept.
          </p>
        </article>

        <article className="panel guide-section" id="guide-strength">
          <h2>Strength (FitNotes)</h2>
          <p>
            Strength has its own ACWR, built the same way from your FitNotes sets. Each import replaces all strength data,
            because the export holds your whole history.
          </p>
          <dl className="guide-terms">
            <dt>Relative intensity (default)</dt>
            <dd>
              Each set counts reps × how heavy it was compared with your best estimated one-rep max on that exercise so far. A
              heavy deadlift set and a hard dip set count about the same.
            </dd>
            <dt>Volume</dt>
            <dd>Weight × reps. Simple, but heavy leg lifts dominate.</dd>
            <dt>Hard sets</dt>
            <dd>Every set counts as one.</dd>
            <dt>+BW</dt>
            <dd>
              For exercises where FitNotes only logs the added weight (pull-ups, dips…), tick +BW so your bodyweight is counted
              too. Timed sets count one rep per 4 seconds.
            </dd>
          </dl>
        </article>

        <article className="panel guide-section" id="guide-toplogger">
          <h2>TopLogger sync</h2>
          <p>
            Each day you climbed at a TopLogger gym becomes one session. Grades come from TopLogger; the wall angle is guessed
            from the wall's name (slab, overhang, roof, board).
          </p>
          <dl className="guide-terms">
            <dt>What counts</dt>
            <dd>
              By default every boulder you tried, sent or not. You can switch to only sends, or to every single try (five goes
              on a project count as five) under Sync options.
            </dd>
            <dt>Weeks you didn't log</dt>
            <dd>
              If nothing is logged for 2 weeks or more between sessions, the Bouldering tab asks whether you were climbing. Say yes
              and those days are filled with your usual load (shown as estimated), so your next sessions don't look like a spike.
            </dd>
            <dt>Editing synced sessions</dt>
            <dd>
              TopLogger doesn't record duration, sleep or stress, so synced sessions get defaults. Edit them in History to fill
              those in; later syncs won't overwrite your edits, and deleted sessions stay deleted.
            </dd>
            <dt>Connecting</dt>
            <dd>
              TopLogger has no official way for other apps to sign in, so you paste a session token once. It is stored only in
              this browser. Signing out on TopLogger itself cancels it.
            </dd>
          </dl>
        </article>

        <article className="panel guide-section" id="guide-data">
          <h2>Your data</h2>
          <p>
            Everything is stored in this browser on this device. Nothing is sent anywhere unless you connect TopLogger (to read
            your climbs) or Google Drive (to store your backups in your own Drive).
          </p>
          <ul className="guide-list">
            <li>Signed in with Google, you can upload a backup to Drive and restore it on another device (Settings).</li>
            <li>You can also export everything to a JSON file and import it again.</li>
            <li>Clearing your browser's site data removes everything that isn't backed up.</li>
          </ul>
        </article>

        <article className="panel guide-section" id="guide-maths">
          <h2>The maths, step by step</h2>
          <div className="math-steps">
            <p>
              Say you climb {example.problems} × {grade(example.baseGrade)} in {example.duration} minutes, with a current max of{" "}
              {grade(referenceGrade)}, and you've been doing two of those a week.
            </p>
            <p>
              <span className="math-label">Points per problem</span>
              {basePoints} × {multiplierPerGrade.toFixed(2)}
              <sup>{gradeToNumber(example.baseGrade) - gradeToNumber(referenceGrade)}</sup> = {example.points.toFixed(2)}
            </p>
            <p>
              <span className="math-label">Session load</span>
              {example.problems} × {example.points.toFixed(2)} × pace {example.speed.toFixed(2)} = <strong>{example.load.toFixed(0)}</strong>
            </p>
            <p>
              <span className="math-label">Acute ({acuteWindow} d)</span>
              α·load + (1 − α)·previous = {example.next.acute.toFixed(1)}
            </p>
            <p>
              <span className="math-label">Chronic ({chronicWindow} d)</span>
              α·load + (1 − α)·previous = {example.next.chronic.toFixed(1)}
            </p>
            <p>
              <span className="math-label">ACWR</span>
              {example.next.acute.toFixed(1)} ÷ {example.next.chronic.toFixed(1)} = <strong>{example.next.acwr.toFixed(2)}</strong>
            </p>
            <p className="muted-hint">
              α = 2 ÷ (window + 1). Both averages start at your average daily load over the first {chronicWindow} days rather
              than at zero, so the ratio isn't inflated while you build up history.
            </p>
          </div>

          <div className="example-grid">
            {variations.map((variation) => (
              <article key={variation.title} className="math-card">
                <h4>{variation.title}</h4>
                <p>
                  Load {variation.load.toFixed(0)} · ACWR {variation.acwr.toFixed(2)}
                </p>
              </article>
            ))}
          </div>

          <h3>How much each day counts</h3>
          <p className="muted-hint">The acute average reacts fast; the chronic one remembers longer.</p>
          <EwmaWeightsChart acuteWindow={acuteWindow} chronicWindow={chronicWindow} />

          <h3>Model curves</h3>
          <div className="curve-grid">
            <CurveChart
              title="Points per problem"
              xLabel="Grade"
              points={gradeCurve}
              color="var(--series-1)"
              xFormatter={(value) => grade(gradeFromNumber(value))}
              yFormatter={formatCompact}
              yLog
            />
            <CurveChart
              title="Pace multiplier"
              xLabel="Problems per hour"
              points={speedCurve}
              color="var(--series-2)"
              xFormatter={(value) => value.toFixed(0)}
              yFormatter={(value) => `${value.toFixed(2)}x`}
            />
          </div>
        </article>

        <article className="panel guide-section" id="guide-faq">
          <h2>FAQ</h2>
          <dl className="guide-terms">
            <dt>Why does my ACWR drop on rest days?</dt>
            <dd>Your recent average forgets faster than your long-term one, so every rest day lowers the ratio a little.</dd>
            <dt>I didn't log for a while and now my ACWR is huge.</dt>
            <dd>
              Unlogged weeks count as rest, so your long-term average dropped and normal sessions now look like a spike. Answer the
              "Were you climbing?" question on the Bouldering tab and the gap is filled with your usual load.
            </dd>
            <dt>Why are the recommended sessions sometimes small?</dt>
            <dd>
              Right after a big session there isn't much room left before the high threshold. A day or two of rest opens it up
              again; the card tells you when.
            </dd>
            <dt>My current max grade looks wrong.</dt>
            <dd>
              It needs a grade on two different days in the past year. Until you have history it uses the max grade from
              Settings.
            </dd>
            <dt>Can I trust the numbers in my first weeks?</dt>
            <dd>
              Roughly. Until you have {chronicWindow} days of history the long-term average is still settling; the Bouldering
              tab says so while it lasts.
            </dd>
          </dl>
        </article>
      </div>
    </section>
  );
}
