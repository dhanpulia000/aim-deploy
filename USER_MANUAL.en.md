# Agent Ops Wallboard V2 — User Guide

> **Version**: 2.5  
> **Last updated**: 2026-04-14  
> **Audience**: All users, including new agents

> **RAG (work guides):** From `backend/`, run  
> `node scripts/import-user-manual-to-rag.js --replace --lang=all`  
> to register **both** this file and `USER_MANUAL.md` into WorkGuide + embeddings. The AI assistant searches `language=en` guides when the UI is English, and `language=ko` when Korean.

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [Main screen](#2-main-screen)
3. [Working with issues](#3-working-with-issues)
4. [Daily workflow](#4-daily-workflow)
5. [Advanced features](#5-advanced-features)
6. [AI assistant](#6-ai-assistant)
7. [Notices](#7-notices)
8. [Desktop notifications](#8-desktop-notifications)
9. [Reports](#9-reports)
10. [Troubleshooting](#10-troubleshooting)
11. [FAQ](#11-faq)
12. [inZOI, forum and channel monitoring](#12-inzoi-forum-and-channel-monitoring)
13. [Screen-by-screen buttons & controls](#13-screen-by-screen-buttons--controls)

<h2 id="guide-management">Admin: work guides, notifications & checklists</h2>

Administrators can maintain **work guides** (RAG-ready knowledge), **work notifications** (scheduled LINE/Discord messages), and **work checklists** (shift/day-specific tasks agents complete). Open **Admin** from the top navigation, then choose the corresponding management screen.  
This HTML anchor (`#guide-management`) is linked from the work-guide admin page for quick reference.

---

## 1. Getting started

### 1.1 What is this system?

**Agent Ops Wallboard V2** is a real-time issue monitoring and handling workspace for game operations teams.

**Highlights**

- Collects issues from sources such as **Naver Cafe** and **Slack**
- **AI classification** and severity
- **Live status** tracking for each issue
- **AI assistant** with RAG over internal guides
- **Desktop notifications** for new or urgent items
- **Notices** with filters by date/week/owner/game
- **Work checklists** by date, work type, and weekday
- **Daily/weekly report** helpers

### 1.2 Sign in

1. Open the **URL** provided by your administrator.
2. Enter your **email** and **password**.
3. Click **Sign in**.

After a successful login you land on the main issue queue. Your name appears in the header when the session is valid.

### 1.3 Main layout (overview)

- **Top bar**: project selector, manual ingest, search, filters, navigation
- **KPI strip**: open issues, Sev1, SLA risk, average handle time
- **Issue queue** (center): priority block + general queue; switch card/list view
- **Agent status** (side): who is online and basic load metrics

---

## 2. Main screen

### 2.1 Project selection

Use the project dropdown to limit issues to one product/service or view **all projects**.

### 2.2 KPI dashboard

Watch **open issues**, **Sev1**, **SLA due soon**, and **average handling time**. Treat SLA-risk items as urgent.

### 2.3 Priority issues

Shows Sev1 and SLA-risk items (up to a limited count; more load as you scroll).

### 2.4 General queue

Lower-severity and waiting items. Toggle **card** vs **list** view from the queue toolbar.

### 2.5 Agent panel

See who is signed in and summary stats. Use it to coordinate handoffs.

### 2.6 Monitoring (ingest source) tabs

On the **main issue board**, above the shortcut cards, the **Monitoring** strip filters tickets by **where they were collected** (not by game/board code):

- **Issues · All sources** — Naver, Discord, system, etc.
- **Issues · Naver Cafe** — Naver only  
- **Issues · Discord** — Discord only  
- **Issues · System & other** — system/other only  

The same choices appear under the **Menu (☰) → Monitoring** section.  
In **Search & filters**, the **Channel** dropdown is the **game/crawler code** (which monitored board), which is a different axis from the tabs above.

---

## 3. Working with issues

1. **Open** an issue from the queue to read detail, history, and links.
2. **Assign / progress** according to your team rules (status fields, owner, etc.).
3. Use **source links** (e.g. Naver Cafe) when you need the original thread.
4. **AI assistant** can suggest replies or look up guides; always verify before sending to players.

---

## 4. Daily workflow

Typical flow:

1. Sign in and select the correct **project**
2. Clear **priority / SLA-risk** items first
3. Process the **general queue**; use filters and search for your scope
4. Complete **checklist** items for your shift if your team uses them
5. Hand off cleanly using **agent status** and any **handover** tools your tenant enables

---

## 5. Advanced features

- **Manual ingest**: add a post URL when automation missed it (permissions may apply).
- **Filters**: ingest source via **Monitoring** tabs; **Channel** = game/crawler; plus severity, date, text search.
- **Menu → Forum monitoring**: separate page for **Discourse daily trends** (hot/new topics, category summary)—not the same data as the ticket queue.
- **Calendar / schedules**: depends on role; see admin-configured menus.

---

## 6. AI assistant

The assistant retrieves **work guides** and policies your admins published. Ask operational questions in natural language; confirm critical answers against official sources.

---

## 7. Notices

Internal announcements with filters (date range, week, owner, game, etc.). Read required notices so you do not miss policy changes.

---

## 8. Desktop notifications

If enabled in the browser, you can receive alerts for new issues or important events. Keep browser notification permission on for the wallboard origin if your team relies on it.

---

## 9. Reports

Use the **daily** and **weekly** report tools (from the menu your administrator exposes) to export or generate summaries. Exact fields depend on project configuration.

---

## 10. Troubleshooting

| Problem | What to try |
|--------|----------------|
| Cannot sign in | Reset password via admin; check caps lock and URL |
| Empty queue | Confirm **project** selection; check filters |
| Stale data | Hard refresh; confirm VPN/network; ask if workers are running |
| AI empty answer | Guides may be missing; ask an admin to upload content |

---

## 11. FAQ

**Q: Where is the user manual link?**  
A: In the header, next to the language switcher—opens this manual in a new tab.

**Q: Can I use English UI?**  
A: Yes, if your tenant enabled i18n; use the language switcher.

**Q: Who configures LINE/Discord notifications?**  
A: Admins under **Work notification** settings.

---

## 12. inZOI, forum and channel monitoring

For titles such as **inZOI**, the app separates **per-ticket channels** (Naver / Discord / …) from the **official forum (Discourse) trend dashboard**.

| Area | What you see | Where |
|------|----------------|--------|
| Tickets | Individual issues, owners, SLA | **Main board** + Monitoring tabs / filters |
| Forum trends | Daily hot/new topics, category rollup | **Menu → Forum monitoring** (dedicated page) |
| Crawl controls | Keywords, triggers, boards | Top nav **Monitoring** (ADMIN/LEAD) — **not** the same as Forum monitoring |

**Forum monitoring page** loads the latest **daily report** from the forum monitoring API. Use **Refresh** and **API docs** as needed. In dev, the app calls `/forum-api`, proxied to the forum service (default port 9090).

**Issue detail**: Discourse-sourced items may show a **hero image** parsed from the ingest preamble when available.

---

## 13. Screen-by-screen buttons & controls

Reference tables for major buttons and toggles. To load **both** the Korean and English manuals into **Guide Management (RAG)**, admins run:

```bash
cd backend && node scripts/import-user-manual-to-rag.js --replace --lang=all
```

Each `###` subsection becomes a separate searchable guide chunk (same structure as `USER_MANUAL.md`).

### 13.1 Global header

| Control | Action |
|--------|--------|
| App title | Go to **main issue board** |
| Project dropdown | Scope data to a project (or all) |
| **☰ Menu** | Navigate to monitoring, work, reference, admin screens |
| **Manual ingest** | Open Naver café URL ingest modal |
| WebSocket badge | Connection status / reconnect |
| AI icon | Open AI assistant |
| Calendar icon | Navigate to `/calendar` |
| Logout | End session |

### 13.2 Menu (☰) entries

**Monitoring**: All issues, Naver (+ manual ingest), Discord, System, **Forum monitoring** (Discourse daily report page).  
**Work**: Work checklist, Handover.  
**Reference**: AI assistant, Notices, Notification settings, Calendar.  
**Admin**: Checklist management, Step floating, **Guide management**, Work notifications.  
**Agents + admins**: Comment watch management.

### 13.3 Main board extras

**Monitoring tabs**: Same source filters as the menu. **Shortcut cards**: Notices, checklist, handover.  
**Customer feedback notices**: Slack user picker (admins), compose/cancel, **Collect from Slack**.

### 13.4 Search & filter panel (collapsible)

Toggle header / ▼. Search box (+ clear **✕**), game/channel select, severity, category, date range, reset date, **reset all filters**, show/hide completed issues, bulk **clear selection**, agent status, KPI cards.

### 13.5 Issue cards / rows

Open detail on row click; checkbox multi-select; **Read**, **Process**, **Exclude from report** (when shown); original link.

### 13.6 Issue detail — header & Slack share

**Capture screenshot** (when no post images), **Share to Slack** (modal: channel, recipients, text, optional image/video, send/cancel), **Close**. Original pane: open link, gallery click → larger view.

### 13.7 Issue detail — triage & comments

Status and assignee dropdowns; category **Save** (read-only if locked); edit AI summary; sentiment analyze; comment submit; Naver **comment watch** interval (requires server worker).

### 13.8 Manual ingest modal

URL, optional cookies, **Start ingest** / **Cancel**.

### 13.9 Forum monitoring

**Refresh**, **API docs**; hot/new topic rows link to forum URLs when present.

### 13.10 Guide Management (admin)

Search, type filter, **File upload** (batch), **New guide**, **View file** / **Edit** / **Delete** per row; modal save/cancel. Manual link opens `#guide-management`.

---

## Appendix

### A. Keyboard shortcuts

- **F5**: Refresh the page
- **Esc**: Close modal dialogs
- **Enter**: Run search (when the search field is focused)
- **Ctrl+F**: Browser find-in-page

### B. Supported browsers

- **Chrome** (recommended)
- **Edge**
- **Firefox**
- Safari may limit some features

### C. Issue status workflow

```
OPEN → TRIAGED → IN_PROGRESS → WAITING (optional) → RESOLVED → VERIFIED (optional)
```

### D. Severity (SLA examples)

- **Sev1**: Urgent (example SLA: 1 hour)
- **Sev2**: High (example SLA: 4 hours)
- **Sev3**: Normal (example SLA: 24 hours)

### E. Support

Contact your administrator for access or system issues.

---

**Document version**: 2.5  
**Last updated**: 2026-04-14  
**Owner**: Agent Ops Team

---

## Change history

- **2026-04-14**: v2.5 — RAG import documents `--lang=all`; appendix added; Guide Management aligned with section 13 tables.
