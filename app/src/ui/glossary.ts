// Plain-language explanations for every training metric the app shows. Each
// entry answers: what is it, how is it computed, how do I read it, and what
// does it NOT tell me. Used by the inline "?" explainers and the glossary.

export type MetricKey =
  | 'np'
  | 'if'
  | 'tss'
  | 'ef'
  | 'decoupling'
  | 'compliance'
  | 'fitness'
  | 'fatigue'
  | 'form'
  | 'rpe'
  | 'intensity'
  | 'verdict'
  | 'vo2max'
  | 'hrmax'
  | 'lthr'
  | 'lt1'
  | 'lt2'
  | 'dfa'
  | 'cp'
  | 'wprime';

export interface MetricExplanation {
  name: string;
  short: string; // one line, shown next to the number
  how: string; // how it is computed
  read: string; // what good / bad looks like
  caveat: string; // what it does not tell you
  source: string;
}

export const GLOSSARY: Record<MetricKey, MetricExplanation> = {
  np: {
    name: 'Normalized power (NP)',
    short: 'Your average power, adjusted so hard moments count extra.',
    how: 'Power is smoothed over 30 seconds, each smoothed value is raised to the fourth power, those are averaged, and the fourth root is taken. The fourth power is what makes a hard minute weigh far more than an easy one.',
    read: 'For a steady ride NP equals average power. For intervals NP sits above average power; the gap tells you how uneven the ride was.',
    caveat: 'It is a model of physiological cost, not a measurement. Two rides with the same NP can stress different systems.',
    source: 'Andrew Coggan, Training and Racing with a Power Meter.',
  },
  if: {
    name: 'Intensity factor (IF)',
    short: 'How hard the ride was relative to your FTP.',
    how: 'Normalized power divided by the FTP that was set when you rode. 1.00 means the whole ride averaged your threshold.',
    read: 'Recovery rides sit around 0.5 to 0.65, endurance 0.65 to 0.75, sweet spot 0.85 to 0.95, intervals above 1.0 for the hard parts.',
    caveat: 'It is only as good as your FTP. If FTP is set too low every ride looks harder than it was.',
    source: 'Andrew Coggan.',
  },
  tss: {
    name: 'Training stress score (TSS)',
    short: 'How much training load one ride represents. One hour at FTP is 100.',
    how: 'Duration in hours times IF squared times 100. Squaring the intensity is what makes a hard hour worth far more than an easy one.',
    read: 'Under 150 you recover by the next day; 150 to 300 leaves some fatigue the next day; over 300 lasts two days or more. Typical weeks for a few hours of serious training total 300 to 500.',
    caveat: 'It measures load, not fitness, and it is blind to which system you stressed. Sprints and a steady threshold hour can score the same.',
    source: 'Andrew Coggan.',
  },
  ef: {
    name: 'Efficiency factor (EF)',
    short: 'Watts per heartbeat. Rises as aerobic fitness improves.',
    how: 'Normalized power divided by average heart rate for the ride.',
    read: 'Only meaningful when comparing the same workout over time: the same watts at a lower heart rate means you got fitter. A few percent over a month is a real change.',
    caveat: 'Heart rate moves with heat, sleep, caffeine, illness and stress, so compare across several rides, not two. Short or very hard rides are noisy.',
    source: 'Joe Friel.',
  },
  decoupling: {
    name: 'Aerobic decoupling',
    short: 'How much heart rate drifted up at constant power during the longest steady block.',
    how: 'The longest steady block of 20 minutes or more is split in half, after a 3-minute settle. Power divided by heart rate is compared between the halves; the drop is the decoupling.',
    read: 'Under 5% means your aerobic base is solid for that duration. Above 5% means heart rate climbed noticeably at the same effort: the base is still being built, or it was hot, or you were dehydrated.',
    caveat: 'Needs a genuinely steady block with heart rate throughout. Intervals and short rides give no value.',
    source: 'Joe Friel.',
  },
  compliance: {
    name: 'Target compliance',
    short: 'Share of the ride spent within 5% of the planned power.',
    how: 'Every second while riding (not paused), after the first 15 seconds of each step, is checked against the target: within 5% or 10 W counts as on target.',
    read: 'In ERG mode the trainer does most of the work, so 90% or more is normal. Lower values usually mean cadence collapsed on hard steps or the trainer could not hold the target.',
    caveat: 'Only computed for ERG workouts. A low value from a device problem is not a sign of fatigue.',
    source: 'This app.',
  },
  fitness: {
    name: 'Fitness (CTL)',
    short: 'The training load your body has adapted to: a 42-day average of daily TSS.',
    how: 'Each day, fitness moves one forty-second of the way from yesterday’s value toward today’s TSS. A rest day pulls it down a little; a big ride pushes it up a little. Coggan calls it chronic training load.',
    read: 'It changes slowly by design. A rise of 3 to 7 points per week is a sustainable build; faster usually means fatigue is piling up ahead of adaptation.',
    caveat: 'It is a load number, not a measurement of ability. A higher fitness value means you have been training more, which usually but not always means you are fitter.',
    source: 'Andrew Coggan, performance management chart.',
  },
  fatigue: {
    name: 'Fatigue (ATL)',
    short: 'Your recent load: a 7-day average of daily TSS.',
    how: 'Same calculation as fitness but with a 7-day window, so it reacts fast. Coggan calls it acute training load.',
    read: 'It spikes after a hard week and falls within days of easing off.',
    caveat: 'It knows nothing about sleep, illness or life stress, which are fatigue too.',
    source: 'Andrew Coggan.',
  },
  form: {
    name: 'Form (TSB)',
    short: 'Fitness minus fatigue: how fresh you are today.',
    how: 'Yesterday’s fitness minus yesterday’s fatigue, so a ride today does not count against today’s freshness. Coggan calls it training stress balance.',
    read: 'Below -30: overreached, rest. -30 to -10: carrying productive fatigue, the normal state while building. -10 to +10: neutral. Above +10: fresh; good for a test or a key session, but fitness fades if it stays there.',
    caveat: 'Negative form is not bad. It is where training happens. It only becomes a problem when the body stops absorbing it, which is what the other signals watch for.',
    source: 'Andrew Coggan.',
  },
  rpe: {
    name: 'Effort rating (RPE)',
    short: 'How hard the ride felt to you, 1 to 10.',
    how: 'You rate it after the ride. 1 is a stroll, 5 is comfortably hard, 8 is hard to hold a conversation, 10 is all out.',
    read: 'The value itself matters less than the trend. The same workout feeling harder than usual, while heart rate does not say so, is the earliest sign of overreaching there is.',
    caveat: 'It is subjective and that is the point: it captures what the sensors cannot. Rate honestly, not by what you think the numbers should say.',
    source: 'Borg CR10 scale.',
  },
  intensity: {
    name: 'Workout intensity',
    short: 'Scales every target in this ride up or down. 100% rides the plan as written.',
    how: 'Each resolved target is multiplied by this percentage. The FTP itself does not change, so your metrics stay comparable across rides.',
    read: 'Use 95% for a week when the verdict says hold or rest, or when the last sessions felt harder than usual; 103 to 105% when they felt easy and the verdict says load. Reserve FTP changes for test days.',
    caveat: 'A scaled ride still counts its real load: TSS reflects the watts you actually rode.',
    source: 'This app.',
  },
  verdict: {
    name: 'Load, hold or rest',
    short: 'A rule-based reading of whether your training load is being absorbed.',
    how: 'Combines form with three absorption signals: efficiency on a repeated workout, your effort ratings, and whether the last hard sessions were completed. Each reason is listed under the verdict. The rules are named form-v1 and their thresholds are fixed, so the same data always gives the same answer.',
    read: 'Load: add volume or intensity. Hold: keep the plan as it is and let the body catch up. Rest: take easy days until form recovers.',
    caveat: 'It is a compass, not a coach. It cannot see sleep, illness, work stress or how you feel this morning. If it says load and you feel wrecked, trust yourself.',
    source: 'Thresholds follow Coggan and Friel conventions.',
  },
  vo2max: {
    name: 'VO2max (estimated)',
    short: 'The most oxygen your body can use per minute: the ceiling of your aerobic engine.',
    how: 'From your ramp test. The best 1-minute power of a ramp to exhaustion (maximal aerobic power) goes into the Hawley and Noakes regression: litres per minute = 0.01141 × watts + 0.435, then divided by your weight for ml/kg/min.',
    read: 'Recreational riders sit around 40 to 50 ml/kg/min, trained amateurs 50 to 65, professionals above 70. Shown as a range because the regression is about 7% off for an individual.',
    caveat: 'It is an estimate from power, not a gas-exchange measurement. It is also hard to move: months of training shift it a few points. Thresholds move more and matter more for racing.',
    source: 'Hawley & Noakes, 1992.',
  },
  hrmax: {
    name: 'Maximum heart rate (observed)',
    short: 'The highest heart rate seen in your last ramp test.',
    how: 'Simply the peak heart rate recorded while you rode the ramp to failure.',
    read: 'Yours, not a formula. It only changes meaningfully with age. Use it to set heart-rate zones if you ride outdoors without power.',
    caveat: 'A ramp stopped early, a hot room or a bad night can leave it a few beats under the true value. Higher values seen later replace it.',
    source: 'Direct observation.',
  },
  lthr: {
    name: 'Threshold heart rate (approximate)',
    short: 'Your heart rate around the second threshold, from the ramp test.',
    how: 'The mean heart rate in the minute after your power first reached the ramp-based FTP estimate. Heart rate trails power in a ramp by 30 to 60 seconds, which that minute roughly compensates.',
    read: 'Outdoors this is the ceiling for efforts you can hold 40 to 60 minutes. The DFA-based threshold heart rate, when available, is the better number.',
    caveat: 'Approximate by construction. A 20- or 30-minute time trial gives a firmer value.',
    source: 'Friel’s LTHR concept, applied to the ramp.',
  },
  lt1: {
    name: 'First threshold (LT1, aerobic threshold)',
    short: 'The intensity below which effort is almost purely aerobic and sustainable for hours.',
    how: 'Estimated from heart-rate variability: the DFA alpha-1 index of your beat-to-beat intervals crosses 0.75 at this intensity. The app pools the estimates of your rides from the last four weeks and needs at least three.',
    read: 'Endurance and recovery rides belong below it. In a race, time below LT1 costs almost nothing; it is where you recover while still moving.',
    caveat: 'Needs a chest strap with clean beat data and steady two-minute stretches of riding. Some riders’ alpha-1 does not behave; if the estimates scatter widely between rides, treat the number as unreliable.',
    source: 'Rogers et al., 2021 (DFA alpha-1 and the aerobic threshold).',
  },
  lt2: {
    name: 'Second threshold (LT2, anaerobic threshold)',
    short: 'The intensity above which lactate and fatigue accumulate: the line between sustainable and borrowed.',
    how: 'Estimated from heart-rate variability: DFA alpha-1 crosses 0.5 at this intensity. Pooled from the last four weeks, at least three rides. It should sit close to your FTP and critical power; the three are different estimates of the same boundary.',
    read: 'Power scales linearly with effort; the metabolic cost does not. Below LT2 you are paying as you go, above it you are spending a finite reserve (W′). For racing, this is the number that decides which moves you can follow.',
    caveat: 'Rides that never reach this intensity give no estimate, by design. Agreement between DFA, FTP and CP within about 5% is a good sign; a big disagreement means one of the tests was not maximal.',
    source: 'Rogers et al., 2021.',
  },
  dfa: {
    name: 'DFA alpha-1',
    short: 'A heart-rate-variability index that falls as intensity rises.',
    how: 'Detrended fluctuation analysis of the beat-to-beat intervals in a two-minute window: how correlated the heartbeat timing is at short scales. Near 1.0 at rest, around 0.75 at the first threshold, around 0.5 at the second.',
    read: 'You never need to read the index itself; the thresholds are derived from where it crosses those values.',
    caveat: 'Ectopic beats and strap dropouts corrupt it. Windows with more than 5% artifacts are discarded, and estimates are never extrapolated beyond the intensities you actually rode.',
    source: 'Peng et al. (DFA); Rogers et al., 2021 (application to exercise thresholds).',
  },
  cp: {
    name: 'Critical power (CP)',
    short: 'The highest power you can hold in a steady state: the hinge of your power-duration curve.',
    how: 'From the 3-minute all-out test: the mean power of the final 30 seconds, after the reserve above it has been exhausted. Must be ridden in Shift mode, all out from the first pedal stroke.',
    read: 'Close to FTP and LT2 for most riders. Efforts below CP can last a long time; above it, your time is set by W′ divided by how far above CP you are.',
    caveat: 'A paced start (not going all out immediately) inflates CP and hides W′. The app flags a test whose final 30 seconds are more than 85% of the first 30 seconds as paced.',
    source: 'Vanhatalo, Doust & Burnley, 2007.',
  },
  wprime: {
    name: 'W′ (anaerobic work capacity)',
    short: 'The finite reserve you can spend above critical power, in kilojoules.',
    how: 'From the 3-minute all-out test: all the work done above CP during the 180 seconds.',
    read: 'Typical values run 10 to 25 kJ. With CP it predicts time to exhaustion: at 50 W over CP, a 15 kJ reserve lasts five minutes. Attacks, climbs and bridging all draw on it; riding below CP refills it.',
    caveat: 'Only as good as the all-out effort it came from. It shrinks with fatigue and is not improved by endurance training.',
    source: 'Monod & Scherrer; Vanhatalo et al., 2007.',
  },
};
