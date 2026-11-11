# Curated Introductions (playing partner matching)

Members who turn on Curated Introductions are introduced to someone new to play with: a person they haven't been out with yet, who fits how they play and has a real reason to talk business on the course. The app finds the candidates. An admin chooses every introduction and sends it. Nothing is suggested automatically, and no AI is involved.

| Part | What it is |
| --- | --- |
| Survey | Optional. **More → Curated Introductions** has one switch, *Turn on Curated Introductions*, and the questions under it. Saving them turns it on. |
| Admin matching | **Admin → Matchmaking.** Pick a member, see the players who fit them ranked by the answers, choose, add a note on why, send. |
| Member view | A push and an email, then **Recommended for you** at the top of Members and on Home, a **Suggested** tag in the member list, and a **Suggested** tab when adding a player to a round. The recommended player is told too. |

## Where it lives

| Piece | File |
| --- | --- |
| Questions, options, validation | `src/lib/matching/survey.ts` |
| Filters, score, chips, note (pure) | `src/lib/matching/rules.ts` |
| Loading the pool and history | `src/lib/matching/candidates.ts`, `src/lib/matching/queue.ts` |
| Survey API | `GET` / `PUT` / `PATCH /api/match-survey` |
| The switch and the survey | `src/app/(app)/more/match-profile/page.tsx`, `src/components/matching/MatchSurveyForm.tsx` |
| Admin screen | `src/app/(admin)/admin/matching/page.tsx`, `GET /api/admin/matching`, `GET` / `POST /api/admin/matching/[memberId]` |
| Member view | `src/hooks/useRecommendations.ts` (one fetch shared by everything below), `src/components/matching/RecommendedPartners.tsx`, `SuggestedTag.tsx`, `SuggestedPlayerPicker.tsx`, `GET /api/recommendations`, `POST /api/recommendations/[id]/dismiss` |
| Schema | `supabase/migrations/20261104000002_partner_matching.sql`, `20261112000002_curated_introductions.sql` |
| Tests | `src/__tests__/matching-rules.test.ts` |

## 1. The switch and the survey

Optional. A member of a club (a home course, active, holding a membership tag) finds it under **More → Curated Introductions**. Guests, referral partners and hosts without a golf membership, and admin accounts without a membership of their own, are told it's for members of a LinkUp club.

- **Never answered:** turning the switch on shows the questions. Saving them turns Curated Introductions on.
- **Answered:** the switch turns it on and off in place, and the answers are kept.
- **Off** means off both ways. The member isn't introduced to anyone, isn't suggested to anyone, and isn't in the admin's queue.

Questions not marked optional are required, because a preference can only be checked against an answer.

### Curated Introduction Preferences

These decide how high a candidate ranks. They don't rule anyone out.

| Question | Answers | Notes |
| --- | --- | --- |
| Objectives (up to 3) | New clients, Referral partners, Capital, Investment deals, Team Members, Vendors, Mentors, Mentees, Just golf | "Mentors" means looking for a mentor, "Mentees" means looking for someone to mentor |
| Preferred industries | The industry list below | Optional. Blank means any industry |
| Preferred roles | Founder / Owner / CEO, Finance, Marketing, Operations, Development, IT, HR, Sales, Legal | Optional. Blank means any role |
| Ideal company size | 1-10, 11-50, 51-200, 201-1000, 1000+, Any size | Any size stands alone |

Industries: Professional Services (Legal), Professional Services (Accounting), Professional Services (Consulting), Capital Provider, Insurance, Business Software, Business Services, HR & Recruitment, Real Estate, Healthcare / Life Sciences, Financial Services, Technology, Non-profit. "Business Owner / Founder" is a role, not an industry, so it's under roles. The industry list on member profiles is unchanged.

### Describe your business

| Question | Answers | Notes |
| --- | --- | --- |
| Organization size | Solopreneurs, 2–10, 11–50, 51–200, 201–1,000 people, More than 1,000 | Solopreneurs and 2–10 count as "1-10" for others' ideal size |
| What industry is your business in? | The industry list | Optional. Pre-filled from the profile where it's on the list |
| Your role | The role list | Optional. What others' preferred roles are checked against |
| What size of organizations do you serve? | Organization sizes | Optional. Makes "potential client" possible |
| Describe your offering | Free text | Optional. Shown on the profile |
| Describe any solutions, services or resources you seek | Free text | Optional. Shown on the profile |

### Describe yourself as a golfer

| Question | Answers |
| --- | --- |
| When do you prefer to play? | Weekday early, midday or twilight; weekend morning or afternoon |
| What's your golf attitude? | Serious, competitive, strict adherence to rules of golf · Friendly competition · Relaxed, casual, "Not Attached to the Outcome". Score keeping optional |
| Golf Skill | Excellent golfer - Low handicap golfers only · Good golfer - Mid to low handicap golfers only · New golfer - Beginners or high handicap golfers only |

The survey no longer asks about hobbies, non-profits or handicap. Those stay on the profile page, and the matcher still reads them from there.

### About you

*Tell us about yourself.* Never shown on a profile.

| Question | Answers | Checked by |
| --- | --- | --- |
| Your gender | Male, Female | Optional. A blank gender fits only members with no gender preference |
| Do you smoke cigars / cigarettes / marijuana on the course? Do you drink alcohol on the course? Do you play music from a speaker on the course? | Yes / No each | The matching "Do you mind …" question |

### Preferred introductions

*Describe the profile of person you would or would not like to play golf with.* Each answer is a filter applied before scoring: it decides who can be recommended, not how highly. "No preference" and "No" rule nobody out.

| Question | Answer options | How the matcher uses it |
| --- | --- | --- |
| Do you have a gender preference? | Male · Female · No preference | Leaves out candidates of another gender, or with none given |
| Do you have a skill level preference? | Excellent golfers - Low handicap golfers only · Good golfers - Mid to low handicap golfers only · New golfers - Beginners or high handicap golfers only · No preference | Checked against the candidate's Golf Skill. Members who answered before Golf Skill existed are read from their handicap: up to 9 excellent, 10 to 18 good, 19 and up (or none) new |
| Do you have a golf attitude preference? | The three attitudes · No preference | Leaves out candidates whose own attitude is different |
| Do you mind playing with people who smoke cigars / cigarettes / marijuana, drink alcohol, or with music playing from speakers? | Yes / No each | Yes leaves out candidates who do it on the course |

### Storage

Pick-lists go to `member_match_profiles`: RLS on, no policies, read only through the service role. What a member offers and seeks stays on `member_profiles`, where the profile page already edits it. `completed_at` is set on the first save. `open_to_suggestions` is the switch.

## 2. Admin matching

**Admin → Matchmaking** has two panes.

**The queue** lists members with Curated Introductions on and no recommendation in the last 30 days, newest survey first. Any member can also be found by name or email. The queue card is sized to the screen and scrolls inside itself; it loads 20 at a time and fetches more as it scrolls, as does the list of players who fit.

**One member** shows their role, industry, course, handicap, objectives, company size, play times, golf skill and attitude, who they want to meet, what they offer and seek, and their preferred introductions. The preferred introductions are visible to admins only. Below that is the candidate list, best first. A member who has it off, or never turned it on, shows a line saying so instead of a list.

### Who's on the candidate list

Left out first:

- anyone outside the member's home course, inactive, hidden, with Curated Introductions off, or never answered
- anyone they've already played with or have a round booked with (`members_played_with`: bookings and hosted events)
- a pair either of them dismissed with Not now in the last 90 days
- anyone either member's preferred introductions rule out

Preferred introductions are checked both ways: B is listed for A only if B fits A's and A fits B's. A candidate who hasn't answered the question a preference needs is left out, because the preference can't be checked. An admin can't override a preference. The list says how many were ruled out.

Everyone left is scored out of 100 (`MATCH_WEIGHTS` in `rules.ts`). The score only orders the list.

| Weight | Component | Measures |
| --- | --- | --- |
| 40 | Business fit | B answers A's objectives: a potential client (B's organization is a size A serves), mentors and mentees, referral partners, capital, team members (B is a recruiter by industry or role), or what A seeks in B's own words |
| 20 | Who they want to meet | B's industry, role and company size against A's preferred industries, roles and ideal size. A blank preference counts as a match |
| 20 | Play fit | Shared play time, same golf skill, same golf attitude |
| 10 | Shared interests | A shared non-profit or hobby, from the profile |
| 10 | Recently active | Signed in within 14 days (half within 30) |

The pair's score is the geometric mean of A→B and B→A, so a match that only works for one person scores low.

### Sending

A pair already sent in either direction stays on the list, ticked and disabled, with when it was sent: "Recommended to Sam" or "Sam was recommended to Dana".

The admin ticks up to 5 players. Each pick carries a note, pre-filled from the rules ("Dana is a founder, the kind of client you serve, and you both play early on weekdays."), which the admin edits or sends as it is. Notes and chips are built from the business and golf answers only and never mention a preference, a gender or a habit.

The server rebuilds the list before saving, so a stale screen can't send a match that no longer fits, and it refuses a member who has Curated Introductions off. Each pick is a `play_suggestions` row with `recommended_by` and `note`; re-sending a pair dismissed long ago reopens its row. The member gets one push and email: "Play with Dana?" with the note for a single pick, "3 playing partners for you" for several. Each recommended player gets their own: "You've been recommended to Sam", linking to Sam's profile. The note isn't in it, since it's written to the member.

**Already sent** shows each recommendation's outcome: Sent, Seen, Not now, Messaged, Round booked, Played together.

## 3. Member view

**Recommended for you** sits at the top of Members (every open recommendation) and on Home (the newest, with a link to the rest). It appears only when there's one to show, and never while the member has Curated Introductions off.

- Photo, name, title, company and industry
- **Why you two**: the admin's note, marked "Recommended by the LinkUp team"
- What the two share: play times and causes
- **Message** opens a new conversation with them
- **Invite to a round** opens booking with them added
- **Not now** hides the recommendation and keeps them off the admin's list for this member for 90 days

Members list: a **Suggested** tag beside each recommended member. Hovering it with a mouse shows the note and what the two share; on a phone, a tap does the same, and a second tap or a tap elsewhere closes it.

Add player, both when booking and on an existing booking: a **Suggested** tab beside Member and Non-member, listing the recommended members who can be added to that round, one tap each. It appears only when there's a recommendation.

Opening the list stamps `seen_at`. Not now and the first save of the survey are recorded as activity (`recommendation_dismissed`, `match_survey_completed`).

## Privacy and trust

- Gender, the smoke, music and booze answers, and the preferred introductions appear only on the admin screen. They're never shown on a profile or named in a note, so nobody learns why someone wasn't recommended to them.
- Hidden profiles and members with Curated Introductions off never appear on a candidate list.
- Only admins send. The send route is behind the admin check, and a member can only read their own `play_suggestions` rows.

## Deploying

Apply `20261104000002_partner_matching.sql` and `20261112000002_curated_introductions.sql` before deploying. The second adds the new answers, moves "Business Owner / Founder" picks to the Founder role, drops "Other" from preferred industries, and clears "Prefer not to say" genders.

## Decisions taken

| Question | Decision |
| --- | --- |
| Mandatory or optional? | Optional, switched on from More (client, 2026-11-12) |
| Home course only, or all of LinkUp? | Home course only |
| What does off mean? | Neither introduced to anyone nor sent introductions; answers kept |
| Tell both members, or only one? | Both: the member gets the recommendation, and each recommended player is told who they were recommended to |
| Include hosts as candidates? | A host who is a member is in the pool like anyone else |
| Do Step 1 preferences filter? | No, they rank. Only the preferred introductions filter |
| Ask the member's own role? | Yes, so preferred roles have something to be checked against. Optional |
