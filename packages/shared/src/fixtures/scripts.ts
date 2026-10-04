/**
 * Fixture script for matcher tests. Deliberately includes common phrases that recur in several
 * paragraphs ("at the end of the day", "thank you very much", "and that is why") so that tests
 * can check that repeated phrases alone never cause jumps.
 */
export const TALK_SCRIPT = `Good morning and thank you very much for coming. Today I want to share what our team learned while rebuilding the onboarding flow for new customers.

At the end of the day, onboarding is a promise. We tell people that the product will make their work easier, and the first ten minutes either keep that promise or break it.

Last spring we interviewed forty customers who had cancelled within their first month. Almost every one of them described the same moment: they imported a spreadsheet, saw a wall of warnings, and gave up. And that is why we started with the importer.

The new importer previews every column before anything is saved. It explains each warning in plain language and suggests a fix. In testing, completion rates climbed from fifty percent to eighty-five percent in 2025.

We also removed four setup screens. Nobody missed them. At the end of the day, fewer decisions up front meant more people reached the dashboard, and that is why retention improved.

Our next experiment is guided templates. Instead of an empty workspace, new customers pick a template that matches their industry, whether that is logistics, healthcare, or retail.

There are risks. Templates can feel generic, and some teams want a blank canvas. So every template will be optional, and we will measure whether people keep them or delete them within a week.

To wrap up: listen to the people who leave, fix the first ten minutes, and measure everything. Thank you very much, and I am happy to take questions.`;

/**
 * A full script written as list lines (dashes, numbers, sub-items). It must keep being tracked
 * word by word: a long list line is a script sentence, not an outline bullet.
 */
export const LIST_SCRIPT = `Three things changed how our customers get started this year.

- First, we stopped asking new customers to configure everything before they had seen a single result in the product.
- Second, the importer now previews every column and explains each warning in plain language before anything is saved.
  - In testing, completion rates climbed from fifty-one to seventy-eight percent within two weeks.
- Third, we removed four setup screens, and nobody has asked us to bring any of them back.

What we plan to do next:

1. Ship guided templates so that a new workspace never starts out completely empty.
2. Measure whether teams keep the template they picked, or replace it within their first month.
3. Talk to every customer who cancels in the first thirty days, and share what they tell us.

Thank you very much, and I am happy to take questions.`;
