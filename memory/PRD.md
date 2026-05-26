# MindSphere — PRD

## Original Problem Statement
Build a full-stack mental wellness SaaS called **MindSphere** — premium dark-space aesthetic, floating-orb UI, all-in-one platform with AI journaling, mood tracking, AI assistant (Lyra), real-time voice mode, diet/exercise/assessments/appointments/analytics/disturbance detection/meditation/sleep/resources/settings. React + Tailwind + Framer Motion. Originally specified Supabase + OpenAI Realtime API; built on FastAPI + Mongo + Emergent LLM (gpt-4o) per user choice.

## User Personas
- **Self-aware adults** seeking a single private space for daily mental wellness work.
- **Therapy adjacent** users who want AI coaching + clinical assessments between sessions.
- **Habit builders** who like data, streaks, and pattern recognition.

## Core Requirements (static)
- Auth (JWT email/password) + onboarding (16 questions incl. religion)
- Deep space dark theme, aurora orbs, Clash Display + DM Sans, glassmorphism, Framer Motion animations
- AI everywhere via gpt-4o through Emergent Universal Key
- 18+ feature screens fully end-to-end functional

## Implemented (2026-05-26)
### Backend (FastAPI + Mongo + emergentintegrations gpt-4o)
- Auth: register / login / me (JWT, bcrypt)
- Onboarding & user prefs (incl. religion)
- Journal CRUD with real-time emotion detection (color, intensity, summary, topics)
- Mood logging + 60d retrieval
- Lyra chat with full user context + persisted history
- Daily affirmation + AI insight + daily verse per religion (Hindu / Christian / Muslim / Buddhist / Jewish / Sikh / Spiritual / None)
- Mental Health comprehensive report (severity, trend, patterns, triggers, strengths, today_actions, diet_focus, exercise_focus, weekly_forecast, warning_signs, snapshot)
- AI Guidance endpoint per feature (3 tailored tips: journal/mood/diet/exercise/sleep/assessments/appointments/analytics/disturbance/meditation/resources/lyra)
- Diet plan (7-day, AI-generated, regen per-meal)
- Hydration tracking
- Exercise library (10 items), today's pick by mood, logging
- Mood-based music recommendations with YouTube + Spotify search URLs
- Body scan: per-part (head/neck/chest/stomach/arms/legs) breathing + yoga protocols + AI compassionate note
- Assessments: PHQ-9, GAD-7, PSS-10, PSQI-lite, Wellbeing Wheel with AI interpretation
- Appointments with AI talking points
- Sleep logs + AI sleep coach
- Analytics summary (heatmap, word cloud, scatter, narrative)
- Disturbance detector + Vision check-in (gpt-4o vision)
- Meditations library (10), Resources (10 + crisis), Religions catalog
- Voice opener generation
- Seeded demo user (Aria Demo) on startup

### Frontend (React + Framer Motion + Recharts + Tailwind)
- Landing page with hero orb, 8 feature cards, 3-step flow, animated counters, footer
- Auth (login/signup + demo button)
- 16-step onboarding incl. religion
- Dashboard: 14 widgets including daily verse from chosen tradition
- Journal: floating bubble constellation, live emotion tag, voice dictation, reading modal, AI prompts card
- Mood: 7 emotion bubbles, intensity, timeline, emotion wheel SVG, pattern noticed, AI tips
- Lyra chat: iMessage-style w/ context awareness + 3 conversation openers
- Voice mode: continuous listening, mic amplitude analyser → orb pulse, interruption (assistant stops when user speaks), graceful reconnects, mute toggle, neural-leaning voice selection, sentence-chunked TTS with prosody variation
- Mental Health: severity/trend hero, radial mood ring, area chart, bar chart, patterns/triggers/strengths grid, today actions, diet/exercise focus, forecast, warning signs, day range selector
- Diet: hydration glass, 7-day plan, per-meal swap
- Exercise: today pick, week streak grid, type filter, library, AI tips
- Assessments: 5 modal-stepper assessments with AI interpretation, history
- Appointments: create modal, AI talking points, directory, cancel/notes
- Analytics: 12-week heatmap, sleep×mood scatter, word cloud, AI narrative, stats
- Disturbance: ranked list w/ recommendations, vision upload (face/environment)
- Meditation: 3 breathing techniques with animated circle, interactive body scan (each part has unique protocol), mood-matched music (YouTube + Spotify links), 10 guided meditations, ambient sound mixer stub
- Sleep: log form, coach tip, sleep debt, recent nights
- Resources: crisis section always visible, category pills, bookmarks
- Settings: profile, Lyra prefs, accent color, notifications, export JSON, integrations stub
- ScrollToTop on every route change
- Aurora background everywhere

### Quality
- Testing agent ran 44 backend tests → 44/44 pass; all 16 routes + all key flows tested in Playwright → green
- One minor button-in-button DOM warning on Mood page — fixed

## Deferred / Backlog
- **P0**: True OpenAI Realtime API + WebRTC voice (needs user OpenAI key — Emergent key doesn't support Realtime API)
- **P1**: Cache `/guidance/*` and `/verses/today` per user/day to reduce LLM cost
- **P1**: D3 emotion wheel / Three.js orb (currently CSS/SVG)
- **P2**: Real Apple Health / Google Fit / Spotify integrations
- **P2**: Refactor server.py into routers (auth, mental_health, content, ai)
- **P2**: Push notifications + scheduled reminders

## Credentials
- demo@mindsphere.app / demo1234 (auto-seeded)
