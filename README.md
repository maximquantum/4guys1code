# KBC Moments: moments, not offers

Tectonic Hackathon, KBC challenge. A proof of concept for scalable personalisation built around **life moments** (moving, a new baby, an income drop, a first salary) instead of products. The system also knows when to stay quiet.

## Run it
Requires Node 18+. No dependencies, no `npm install`.

    npm start        # prints a random demo password; or set DEMO_PASSWORD
    npm test         # end-to-end checks (auth, IDOR, consent, feedback)

Open http://127.0.0.1:3000. Users: `c001`..`c060` (customers) or `advisor`. Try:
- `c001` Sarah: moved, sees a card with "Why am I seeing this?" and can dismiss or say "This isn't right"
- `c003` Lina: income stopped, gets a soft, advisor-first message with no sales pitch
- `c005` Emma: moved but gave no consent, so nothing is analysed
- `c006` Lucas: baby moment, but the monthly contact budget is used up, so we stay quiet
- `advisor`: sees every customer, the moment, confidence, evidence, and why the system stayed quiet

## How it answers the challenge
1. **Signals:** transaction patterns (movers, furniture, baby stores, salary deposits). Synthetic data only.
2. **Recognition:** small deterministic "moment detectors" that return a moment, a confidence and evidence.
3. **Adaptation:** a decision layer applies consent, a confidence threshold, customer dismissals and a monthly contact budget. "Do nothing" is a valid outcome. Sensitive moments get advisor-first wording.
4. **Across channels:** one moment state feeds the customer app (card) and the advisor desk (list). The playbook marks each moment's channel.
5. **Scale:** detectors are cheap rules that can run on an event stream. An LLM is only needed for the customers with an active moment, so cost scales with moments, not with 2.3M customers.

**Trust:** every card has a "why" panel. "This isn't right" stops that moment for the customer and lowers detector confidence globally (one vote per customer, capped, so it can't be spammed).

## Security
Sessions with random tokens; identity always comes from the session (no customer ID in requests, so no IDOR); customer and advisor roles enforced per endpoint; constant-time password check; login rate limiting; body size limit; strict CSP and security headers; UI uses `textContent` only; no secrets in the repo; synthetic data only.

## Unfinished / out of scope
- No voice channel (ElevenLabs) and no LLM-written explanations (Gemini): explanations are templated.
- Data is generated in memory; no database or cloud deployment. Production path: events → Pub/Sub → Cloud Run detectors → Firestore/BigQuery.
- Detector rules are hand-written; a real system would learn and validate them.
- Sessions, feedback and rate limits are in memory and reset on restart.
