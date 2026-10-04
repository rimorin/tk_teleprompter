/**
 * Outline fixtures: an outline, and a talk given from it in the speaker's own words. Each talk
 * entry is one final segment, labelled with the bullet the speaker is truly on.
 */
export type TalkSegment = [bullet: number, text: string];

/**
 * Deliberately hard: the intro previews later points, a tangent, a bullet only ever
 * paraphrased ("by hand" for "manual"), an echo of an earlier point, a one-word bullet.
 */
export const ONBOARDING_OUTLINE = `- Why we are here: onboarding takes too long
- Customer interviews: 12 teams, setup takes 3 weeks
- Root cause: manual data migration
- Pilot: automated importer with Acme Logistics
  - mapping suggestions
- Results: setup down to 4 days, fewer support tickets
- The ask: two engineers for the Q3 rollout
- Questions`;

export const ONBOARDING_TALK: TalkSegment[] = [
  [0, 'good morning everyone thanks for making the time'],
  [0, 'so I want to talk about something that has been bugging me all year'],
  [0, 'which is how long it takes a new customer to get up and running'],
  [0, 'I am going to walk you through what we found what we tried'],
  [0, 'and at the end I will have a small ask for you'],
  [0, 'and honestly the results surprised us a bit'],
  [0, 'so the short version is onboarding is just way too slow'],
  [1, 'so first we went and talked to customers'],
  [1, 'we sat down with twelve different teams over about a month'],
  [1, 'some big some tiny one of them was literally three people'],
  [1, 'I remember this one call with a guy in Rotterdam'],
  [1, 'he had his dog barking the entire time and his kid came in'],
  [1, 'anyway he was great and super candid with us'],
  [1, 'and the thing almost every team told us'],
  [1, 'is that it took them roughly three weeks before they were live'],
  [1, 'three weeks before they got any value out of the product'],
  [2, 'so why does it take so long'],
  [2, 'when we dug into it the time is not going where we expected'],
  [2, 'it is not training it is not configuration'],
  [2, 'it is moving their old records across by hand'],
  [2, 'people are literally copying spreadsheets and pasting rows'],
  [2, 'and every customer has a slightly different format'],
  [2, 'so our support folks end up cleaning their data for them'],
  [3, 'so we thought what if we just automate that part'],
  [3, 'we built a small importer that reads their spreadsheets directly'],
  [3, 'and we piloted it with Acme Logistics'],
  [3, 'they were a good test because their data was a mess'],
  [3, 'thousands of shipments half the columns named differently'],
  [3, 'and the importer figures out the mapping and asks only when unsure'],
  [4, 'and here is what happened'],
  [4, 'Acme went from the usual three weeks to four days'],
  [4, 'four days end to end'],
  [4, 'and the number of tickets they opened with us dropped a lot'],
  [4, 'like our support team noticed before we even told them'],
  [4, 'they were asking what changed with this customer'],
  [5, 'so this is where I need your help'],
  [5, 'right now this is a prototype that two of us hacked together'],
  [5, 'to roll it out to everyone next quarter'],
  [5, 'we need two more engineers for about three months'],
  [5, 'ideally people who know the data pipeline side'],
  [6, 'that is it from me'],
  [6, 'happy to take any questions'],
  [6, 'yes go ahead'],
];

/**
 * A speaker who comments around their bullets more than voicing them ("output did not drop"
 * for "productivity held steady"). Written before the outline settings were tuned, and not
 * tuned against: a check that the settings aren't fitted to the onboarding talk.
 */
export const FOUR_DAY_WEEK_OUTLINE = `1. Context: burnout survey results
2. Trial design: 6 months, 3 teams
3. Productivity held steady
4. Customer response times
5. Concerns: on-call coverage, hiring
6. Recommendation: extend to engineering`;

export const FOUR_DAY_WEEK_TALK: TalkSegment[] = [
  [0, 'okay let us get started'],
  [0, 'last year we ran our usual staff survey'],
  [0, 'and the numbers on burnout were frankly alarming'],
  [0, 'almost half of people said they felt exhausted most weeks'],
  [0, 'that was the trigger for all of this'],
  [1, 'so here is how we set it up'],
  [1, 'we picked three teams of different sizes'],
  [1, 'they worked four days for six months at full pay'],
  [1, 'and we measured them against teams that kept the normal week'],
  [1, 'I will be honest the first month was rough'],
  [1, 'people kept checking slack on fridays'],
  [2, 'but output did not drop'],
  [2, 'tickets closed features shipped all of that stayed basically flat'],
  [2, 'one team actually got a bit more done'],
  [2, 'which nobody predicted including me'],
  [3, 'now the thing everyone worried about was customers'],
  [3, 'would they wait longer for answers'],
  [3, 'response times went up by about twenty minutes on average'],
  [3, 'which is within our target so we were fine'],
  [4, 'there are real problems though'],
  [4, 'on call is hard to cover when a whole team is off on friday'],
  [4, 'we had to rotate people which they did not love'],
  [4, 'and recruiting gets complicated because the contract is different'],
  [5, 'so my recommendation is simple'],
  [5, 'keep it going and add the engineering teams next'],
  [5, 'we can revisit the on call question in three months'],
  [5, 'thank you'],
];
