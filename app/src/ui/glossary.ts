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
  | 'verdict';

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
};
